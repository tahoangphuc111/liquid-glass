#![cfg_attr(not(test), no_std)]

use core::cell::UnsafeCell;

const BMP_HEADER_BYTES: usize = 64;
const MAX_BMP_BYTES: usize = BMP_HEADER_BYTES + 136_000 * 4;

const LUT_LEN: usize = 128;
const SURFACE_COUNT: usize = 4;

const SURFACE_CONVEX_SQUIRCLE: i32 = 0;
const SURFACE_CONVEX_CIRCLE: i32 = 1;
const SURFACE_LINEAR: i32 = 2;
const SURFACE_LIP: i32 = 3;

const FLAG_PILL: i32 = 1;
const FLAG_AXIS_X: i32 = 2;

struct SyncCell<T>(UnsafeCell<T>);
unsafe impl<T> Sync for SyncCell<T> {}

struct SurfaceLut {
    initialized: bool,
    height: [[f32; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[f32; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[f32; LUT_LEN]; SURFACE_COUNT],
}

static SURFACE_LUT: SyncCell<SurfaceLut> = SyncCell(UnsafeCell::new(SurfaceLut {
    initialized: false,
    height: [[0.0; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[0.0; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[1.0; LUT_LEN]; SURFACE_COUNT],
}));

#[cfg(not(test))]
static MAX_DISPLACEMENT: SyncCell<f32> = SyncCell(UnsafeCell::new(0.0));

#[cfg(not(test))]
static BMP_BUFFER: SyncCell<[u8; MAX_BMP_BYTES]> = SyncCell(UnsafeCell::new([0u8; MAX_BMP_BYTES]));

#[cfg(test)]
std::thread_local! {
    static TEST_MAX_DISPLACEMENT: UnsafeCell<f32> = const { UnsafeCell::new(0.0) };
    static TEST_BMP_BUFFER: UnsafeCell<[u8; MAX_BMP_BYTES]> =
        const { UnsafeCell::new([0u8; MAX_BMP_BYTES]) };
}

#[cfg(not(test))]
#[panic_handler]
fn panic_handler(_info: &core::panic::PanicInfo) -> ! {
    loop {}
}

#[inline(always)]
fn max_displacement_ptr() -> *mut f32 {
    #[cfg(test)]
    {
        TEST_MAX_DISPLACEMENT.with(|cell| cell.get())
    }
    #[cfg(not(test))]
    {
        MAX_DISPLACEMENT.0.get()
    }
}

#[inline(always)]
fn bmp_buffer_ptr() -> *mut u8 {
    #[cfg(test)]
    {
        TEST_BMP_BUFFER.with(|cell| unsafe { (*cell.get()).as_mut_ptr() })
    }
    #[cfg(not(test))]
    {
        unsafe { (*BMP_BUFFER.0.get()).as_mut_ptr() }
    }
}

#[no_mangle]
pub extern "C" fn getMaxDisplacementOffset() -> usize {
    max_displacement_ptr() as usize
}

#[no_mangle]
pub extern "C" fn getBmpOffset() -> usize {
    bmp_buffer_ptr() as usize
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(always)]
fn sqrt_f32(value: f32) -> f32 {
    use core::arch::wasm32::{f32x4_extract_lane, f32x4_splat, f32x4_sqrt};
    if value <= 0.0 {
        return 0.0;
    }
    f32x4_extract_lane::<0>(f32x4_sqrt(f32x4_splat(value)))
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
#[inline(always)]
fn sqrt_f32(value: f32) -> f32 {
    if value <= 0.0 {
        return 0.0;
    }
    #[cfg(test)]
    {
        value.sqrt()
    }
    #[cfg(not(test))]
    {
        let mut guess = f32::from_bits((value.to_bits() >> 1) + 0x1fc0_0000);
        guess = 0.5 * (guess + value / guess);
        guess = 0.5 * (guess + value / guess);
        0.5 * (guess + value / guess)
    }
}

#[inline(always)]
fn clamp_f32(value: f32, min_val: f32, max_val: f32) -> f32 {
    if value < min_val {
        min_val
    } else if value > max_val {
        max_val
    } else {
        value
    }
}

#[inline]
fn eval_surface_height_and_slope(surface_id: i32, x: f32) -> (f32, f32) {
    let cx = clamp_f32(x, 0.001, 0.999);
    let u = 1.0 - cx;

    match surface_id {
        SURFACE_CONVEX_SQUIRCLE => {
            let u2 = u * u;
            let u4 = u2 * u2;
            let one_minus_u2 = (1.0 - u2).max(1e-6);
            let one_minus_u4 = (1.0 - u4).max(1e-6);

            let circle_h = sqrt_f32(one_minus_u2);
            let squircle_root = sqrt_f32(one_minus_u4);
            let squircle_h = sqrt_f32(squircle_root);
            let height = 0.30 * circle_h + 0.70 * squircle_h;

            let inv_c = 1.0 / circle_h;
            let inv_s3 = 1.0 / (squircle_root * squircle_h);
            let slope = u * (0.30 * inv_c + 0.70 * u2 * inv_s3);
            (height, slope)
        }
        SURFACE_CONVEX_CIRCLE => {
            let one_minus_u2 = (1.0 - u * u).max(1e-6);
            let height = sqrt_f32(one_minus_u2);
            let slope = u / height;
            (height, slope)
        }
        SURFACE_LINEAR => (cx, 1.0),
        SURFACE_LIP => {
            let height = 3.0 * cx * cx - 2.0 * cx * cx * cx + 1.2 * cx * u;
            let slope = 6.0 * cx * u + (1.0 - 2.0 * cx) * 1.2;
            (height.max(0.0), slope)
        }
        _ => (cx, 1.0),
    }
}

#[no_mangle]
pub extern "C" fn initTables() {
    let lut = unsafe { &mut *SURFACE_LUT.0.get() };
    let inv_steps = 1.0 / ((LUT_LEN - 1) as f32);

    let mut surface_id = 0i32;
    while surface_id < SURFACE_COUNT as i32 {
        let idx = surface_id as usize;
        let mut i = 0usize;
        while i < LUT_LEN {
            let x = (i as f32) * inv_steps;
            let (height, slope) = eval_surface_height_and_slope(surface_id, x);
            let norm = sqrt_f32(1.0 + slope * slope);
            lut.height[idx][i] = height;
            lut.sin_i[idx][i] = slope / norm;
            lut.cos_i[idx][i] = 1.0 / norm;
            i += 1;
        }
        surface_id += 1;
    }

    lut.initialized = true;
}

fn build_refraction_lut(
    surface_id: i32,
    scaled_bezel: f32,
    glass_thickness: f32,
    ior: f32,
    out_disp: &mut [f32; LUT_LEN],
) -> f32 {
    let lut = unsafe { &*SURFACE_LUT.0.get() };
    if !lut.initialized {
        initTables();
    }

    let safe_surface = if (0..SURFACE_COUNT as i32).contains(&surface_id) {
        surface_id as usize
    } else {
        0
    };
    let eta = 1.0 / ior.max(1.01);
    let mut max_abs_disp = 0.0_f32;

    let mut i = 0usize;
    while i < LUT_LEN {
        let h = lut.height[safe_surface][i];
        let sin_i = lut.sin_i[safe_surface][i];
        let cos_i = lut.cos_i[safe_surface][i];

        let sin_t = clamp_f32(eta * sin_i, -0.999, 0.999);
        let cos_t = sqrt_f32((1.0 - sin_t * sin_t).max(1e-6));

        let sin_delta = sin_i * cos_t - cos_i * sin_t;
        let cos_delta = (cos_i * cos_t + sin_i * sin_t).max(1e-4);
        let depth = scaled_bezel * h + glass_thickness;
        let disp = depth * (sin_delta / cos_delta);

        out_disp[i] = disp;
        let abs_disp = if disp < 0.0 { -disp } else { disp };
        if abs_disp > max_abs_disp {
            max_abs_disp = abs_disp;
        }
        i += 1;
    }

    max_abs_disp.max(1e-4)
}

#[inline(always)]
fn sample_disp_lut(disp_lut: &[f32; LUT_LEN], t: f32) -> f32 {
    let scaled = clamp_f32(t, 0.0, 1.0) * ((LUT_LEN - 1) as f32);
    let idx = scaled as usize;
    if idx >= LUT_LEN - 1 {
        return disp_lut[LUT_LEN - 1];
    }
    let frac = scaled - (idx as f32);
    disp_lut[idx] + (disp_lut[idx + 1] - disp_lut[idx]) * frac
}

#[inline(always)]
fn encode_channel(normalized_offset: f32) -> u8 {
    let raw = 127.5 + normalized_offset * 127.5;
    let rounded = if raw >= 0.0 { raw + 0.5 } else { raw - 0.5 };
    clamp_f32(rounded, 0.0, 255.0) as u8
}

#[inline(always)]
unsafe fn write_bgra_pixel(pixel_ptr: *mut u8, norm_x: f32, norm_y: f32) {
    *pixel_ptr = 128;
    *pixel_ptr.add(1) = encode_channel(norm_y);
    *pixel_ptr.add(2) = encode_channel(norm_x);
    *pixel_ptr.add(3) = 255;
}

#[inline(always)]
unsafe fn write_u16_le(ptr: *mut u8, offset: usize, value: u16) {
    let bytes = value.to_le_bytes();
    core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(offset), 2);
}

#[inline(always)]
unsafe fn write_u32_le(ptr: *mut u8, offset: usize, value: u32) {
    let bytes = value.to_le_bytes();
    core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(offset), 4);
}

#[inline(always)]
unsafe fn write_i32_le(ptr: *mut u8, offset: usize, value: i32) {
    let bytes = value.to_le_bytes();
    core::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.add(offset), 4);
}

unsafe fn write_bmp_header(header_ptr: *mut u8, width: i32, height: i32, pixel_bytes: u32) {
    core::ptr::write_bytes(header_ptr, 0, BMP_HEADER_BYTES);
    *header_ptr = b'B';
    *header_ptr.add(1) = b'M';
    write_u32_le(header_ptr, 2, BMP_HEADER_BYTES as u32 + pixel_bytes);
    write_u32_le(header_ptr, 10, BMP_HEADER_BYTES as u32);
    write_u32_le(header_ptr, 14, 40);
    write_i32_le(header_ptr, 18, width);
    write_i32_le(header_ptr, 22, -height);
    write_u16_le(header_ptr, 26, 1);
    write_u16_le(header_ptr, 28, 32);
    write_u32_le(header_ptr, 34, pixel_bytes);
    write_i32_le(header_ptr, 38, 2835);
    write_i32_le(header_ptr, 42, 2835);
}

#[inline(always)]
unsafe fn write_max_displacement(value: f32) {
    max_displacement_ptr().write_unaligned(value);
}

#[inline]
unsafe fn write_axis_x_strip(
    pixel_base: *mut u8,
    target_w: usize,
    scaled_bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    let width_f = target_w as f32;
    let half_w = width_f * 0.5;
    let inv_bezel = 1.0 / scaled_bezel.max(1e-4);

    let mut x = 0usize;
    while x < target_w {
        let px = x as f32 + 0.5;
        let dist_edge = if px < half_w { px } else { width_f - px };
        let norm_x = if dist_edge < scaled_bezel {
            let t = dist_edge * inv_bezel;
            let disp = sample_disp_lut(disp_lut, t);
            let sign = if px < half_w { 1.0 } else { -1.0 };
            sign * disp * inv_max_disp
        } else {
            0.0
        };
        write_bgra_pixel(pixel_base.add(x * 4), norm_x, 0.0);
        x += 1;
    }
}

#[inline(always)]
fn eval_scalar_pixel(
    px: f32,
    py: f32,
    half_w: f32,
    half_h: f32,
    radius: f32,
    scaled_bezel: f32,
    inv_bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) -> (f32, f32) {
    let abs_x = if px < 0.0 { -px } else { px };
    let abs_y = if py < 0.0 { -py } else { py };
    let qx = abs_x - half_w + radius;
    let qy = abs_y - half_h + radius;
    let q_plus_x = if qx > 0.0 { qx } else { 0.0 };
    let q_plus_y = if qy > 0.0 { qy } else { 0.0 };
    let out_len = sqrt_f32(q_plus_x * q_plus_x + q_plus_y * q_plus_y);
    let q_max = if qx > qy { qx } else { qy };
    let in_dist = if q_max < 0.0 { q_max } else { 0.0 };
    let sd = out_len + in_dist - radius;

    if sd >= 0.0 {
        return (0.0, 0.0);
    }

    let depth = -sd;
    if depth >= scaled_bezel {
        return (0.0, 0.0);
    }

    let t = depth * inv_bezel;
    let disp = sample_disp_lut(disp_lut, t) * inv_max_disp;

    let sign_x = if px < 0.0 { -1.0 } else if px > 0.0 { 1.0 } else { 0.0 };
    let sign_y = if py < 0.0 { -1.0 } else if py > 0.0 { 1.0 } else { 0.0 };

    let (nx, ny) = if out_len > 1e-5 {
        let inv_len = 1.0 / out_len;
        (-sign_x * q_plus_x * inv_len, -sign_y * q_plus_y * inv_len)
    } else if qx > qy {
        (-sign_x, 0.0)
    } else {
        (0.0, -sign_y)
    };

    (nx * disp, ny * disp)
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
unsafe fn write_row_simd(
    row_ptr: *mut u8,
    target_w: usize,
    py: f32,
    half_w: f32,
    half_h: f32,
    radius: f32,
    scaled_bezel: f32,
    inv_bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    use core::arch::wasm32::*;

    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let neg_one = f32x4_splat(-1.0);
    let radius_v = f32x4_splat(radius);
    let bezel_v = f32x4_splat(scaled_bezel);
    let inv_bezel_v = f32x4_splat(inv_bezel);
    let inner_x_v = f32x4_splat(half_w - radius);
    let step_x = f32x4(0.5, 1.5, 2.5, 3.5);

    let abs_y = if py < 0.0 { -py } else { py };
    let qy = abs_y - half_h + radius;
    let qy_v = f32x4_splat(qy);
    let q_plus_y_v = f32x4_splat(if qy > 0.0 { qy } else { 0.0 });
    let q_plus_y_sq_v = f32x4_mul(q_plus_y_v, q_plus_y_v);
    let sign_y = if py < 0.0 { -1.0 } else if py > 0.0 { 1.0 } else { 0.0 };
    let neg_sign_y_v = f32x4_splat(-sign_y);

    let mut x = 0usize;
    while x + 4 <= target_w {
        let px_v = f32x4_sub(f32x4_add(f32x4_splat(x as f32), step_x), f32x4_splat(half_w));
        let qx_v = f32x4_sub(f32x4_abs(px_v), inner_x_v);
        let q_plus_x_v = f32x4_max(qx_v, zero);
        let out_len_v = f32x4_sqrt(f32x4_add(f32x4_mul(q_plus_x_v, q_plus_x_v), q_plus_y_sq_v));
        let in_dist_v = f32x4_min(f32x4_max(qx_v, qy_v), zero);
        let sd_v = f32x4_sub(f32x4_add(out_len_v, in_dist_v), radius_v);
        let depth_v = f32x4_neg(sd_v);

        let inside_mask = i32x4_bitmask(f32x4_lt(sd_v, zero))
            & i32x4_bitmask(f32x4_lt(depth_v, bezel_v));

        if inside_mask == 0 {
            v128_store(row_ptr.add(x * 4) as *mut v128, u32x4_splat(0xff80_8080));
            x += 4;
            continue;
        }

        let t_v = f32x4_mul(depth_v, inv_bezel_v);
        let disp_v = f32x4(
            if (inside_mask & 1) != 0 { sample_disp_lut(disp_lut, f32x4_extract_lane::<0>(t_v)) * inv_max_disp } else { 0.0 },
            if (inside_mask & 2) != 0 { sample_disp_lut(disp_lut, f32x4_extract_lane::<1>(t_v)) * inv_max_disp } else { 0.0 },
            if (inside_mask & 4) != 0 { sample_disp_lut(disp_lut, f32x4_extract_lane::<2>(t_v)) * inv_max_disp } else { 0.0 },
            if (inside_mask & 8) != 0 { sample_disp_lut(disp_lut, f32x4_extract_lane::<3>(t_v)) * inv_max_disp } else { 0.0 },
        );

        let neg_mask = f32x4_lt(px_v, zero);
        let pos_mask = f32x4_gt(px_v, zero);
        let sign_x_v = v128_or(v128_and(neg_mask, neg_one), v128_and(pos_mask, one));
        let neg_sign_x_v = f32x4_neg(sign_x_v);

        let corner_mask = f32x4_gt(out_len_v, f32x4_splat(1e-5));
        let inv_len_v = f32x4_div(one, f32x4_max(out_len_v, f32x4_splat(1e-5)));
        let corner_nx_v = f32x4_mul(f32x4_mul(neg_sign_x_v, q_plus_x_v), inv_len_v);
        let corner_ny_v = f32x4_mul(f32x4_mul(neg_sign_y_v, q_plus_y_v), inv_len_v);

        let x_edge_mask = f32x4_gt(qx_v, qy_v);
        let edge_nx_v = v128_and(x_edge_mask, neg_sign_x_v);
        let edge_ny_v = v128_andnot(neg_sign_y_v, x_edge_mask);

        let nx_v = v128_bitselect(corner_nx_v, edge_nx_v, corner_mask);
        let ny_v = v128_bitselect(corner_ny_v, edge_ny_v, corner_mask);

        let off_x_v = f32x4_mul(nx_v, disp_v);
        let off_y_v = f32x4_mul(ny_v, disp_v);

        write_bgra_pixel(row_ptr.add(x * 4), f32x4_extract_lane::<0>(off_x_v), f32x4_extract_lane::<0>(off_y_v));
        write_bgra_pixel(row_ptr.add((x + 1) * 4), f32x4_extract_lane::<1>(off_x_v), f32x4_extract_lane::<1>(off_y_v));
        write_bgra_pixel(row_ptr.add((x + 2) * 4), f32x4_extract_lane::<2>(off_x_v), f32x4_extract_lane::<2>(off_y_v));
        write_bgra_pixel(row_ptr.add((x + 3) * 4), f32x4_extract_lane::<3>(off_x_v), f32x4_extract_lane::<3>(off_y_v));

        x += 4;
    }

    while x < target_w {
        let px = x as f32 + 0.5 - half_w;
        let (off_x, off_y) = eval_scalar_pixel(
            px,
            py,
            half_w,
            half_h,
            radius,
            scaled_bezel,
            inv_bezel,
            disp_lut,
            inv_max_disp,
        );
        write_bgra_pixel(row_ptr.add(x * 4), off_x, off_y);
        x += 1;
    }
}

#[no_mangle]
pub extern "C" fn generateDisplacementBmp(
    target_w: i32,
    target_h: i32,
    radius: f32,
    clamped_bezel: f32,
    glass_thickness: f32,
    scale_factor: f32,
    ior: f32,
    surface_id: i32,
    flags: i32,
) -> i32 {
    if target_w <= 0 || target_h <= 0 {
        unsafe { write_max_displacement(0.0) };
        return 0;
    }

    let w = target_w as usize;
    let h = target_h as usize;
    let pixel_bytes = w.saturating_mul(h).saturating_mul(4);
    let total_bytes = BMP_HEADER_BYTES.saturating_add(pixel_bytes);
    if total_bytes > MAX_BMP_BYTES {
        unsafe { write_max_displacement(0.0) };
        return 0;
    }

    let safe_scale = scale_factor.max(1e-4);
    let half_w = (w as f32) * 0.5;
    let half_h = (h as f32) * 0.5;
    let half_min = if half_w < half_h { half_w } else { half_h };

    let is_pill = (flags & FLAG_PILL) != 0;
    let is_axis_x = (flags & FLAG_AXIS_X) != 0;

    let scaled_bezel = if is_axis_x {
        clamp_f32(clamped_bezel * safe_scale, 1.0, half_w)
    } else {
        clamp_f32(clamped_bezel * safe_scale, 1.0, half_min.max(1.0))
    };

    let scaled_radius = if is_pill {
        half_min
    } else {
        clamp_f32(radius * safe_scale, 0.0, half_min)
    };

    let mut disp_lut = [0.0_f32; LUT_LEN];
    let max_disp_target = build_refraction_lut(
        surface_id,
        scaled_bezel,
        glass_thickness,
        ior,
        &mut disp_lut,
    );
    let inv_max_disp = 1.0 / max_disp_target;
    let max_displacement_css = max_disp_target / safe_scale;

    unsafe {
        write_max_displacement(max_displacement_css);
        let bmp_ptr = bmp_buffer_ptr();
        write_bmp_header(bmp_ptr, target_w, target_h, pixel_bytes as u32);
        let pixel_base = bmp_ptr.add(BMP_HEADER_BYTES);

        if is_axis_x && h == 1 {
            write_axis_x_strip(pixel_base, w, scaled_bezel, &disp_lut, inv_max_disp);
            return total_bytes as i32;
        }

        let inv_bezel = 1.0 / scaled_bezel.max(1e-4);
        let row_stride = w * 4;
        let mut y = 0usize;
        while y < h {
            let py = y as f32 + 0.5 - half_h;
            let row_ptr = pixel_base.add(y * row_stride);

            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            write_row_simd(
                row_ptr,
                w,
                py,
                half_w,
                half_h,
                scaled_radius,
                scaled_bezel,
                inv_bezel,
                &disp_lut,
                inv_max_disp,
            );

            #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
            {
                let mut x = 0usize;
                while x < w {
                    let px = x as f32 + 0.5 - half_w;
                    let (off_x, off_y) = eval_scalar_pixel(
                        px,
                        py,
                        half_w,
                        half_h,
                        scaled_radius,
                        scaled_bezel,
                        inv_bezel,
                        &disp_lut,
                        inv_max_disp,
                    );
                    write_bgra_pixel(row_ptr.add(x * 4), off_x, off_y);
                    x += 1;
                }
            }

            y += 1;
        }
    }

    total_bytes as i32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn read_max_displacement() -> f32 {
        unsafe { max_displacement_ptr().read_unaligned() }
    }

    fn read_bmp_slice(len: usize) -> &'static [u8] {
        unsafe { core::slice::from_raw_parts(bmp_buffer_ptr(), len) }
    }

    #[test]
    fn generates_valid_bmp_and_symmetric_displacement_for_all_surfaces() {
        initTables();
        for surface_id in 0..4 {
            let len = generateDisplacementBmp(64, 32, 16.0, 12.0, 42.0, 1.0, 2.05, surface_id, 0);
            assert_eq!(len, 64 + 64 * 32 * 4);
            assert!(read_max_displacement() > 0.0);

            let bmp = read_bmp_slice(len as usize);
            assert_eq!(bmp[0], b'B');
            assert_eq!(bmp[1], b'M');
            assert_eq!(u32::from_le_bytes([bmp[10], bmp[11], bmp[12], bmp[13]]), 64);
            assert_eq!(i32::from_le_bytes([bmp[18], bmp[19], bmp[20], bmp[21]]), 64);
            assert_eq!(i32::from_le_bytes([bmp[22], bmp[23], bmp[24], bmp[25]]), -32);

            let center = 64 + (16 * 64 + 32) * 4;
            assert_eq!(&bmp[center..center + 4], &[128, 128, 128, 255]);

            let left = 64 + (16 * 64) * 4;
            let right = 64 + (16 * 64 + 63) * 4;
            assert!(bmp[left + 2] > 128);
            assert!(bmp[right + 2] < 128);
        }
    }

    #[test]
    fn generates_1d_horizontal_strip_for_axis_x_mode() {
        initTables();
        let len = generateDisplacementBmp(128, 1, 20.0, 18.0, 60.0, 1.0, 2.05, 0, FLAG_PILL | FLAG_AXIS_X);
        assert_eq!(len, 64 + 128 * 4);
        assert!(read_max_displacement() > 0.0);

        let bmp = read_bmp_slice(len as usize);
        let left = 64;
        let center = 64 + 64 * 4;
        let right = 64 + 127 * 4;
        assert!(bmp[left + 2] > 128);
        assert_eq!(bmp[left + 1], 128);
        assert_eq!(&bmp[center..center + 4], &[128, 128, 128, 255]);
        assert!(bmp[right + 2] < 128);
    }
}
