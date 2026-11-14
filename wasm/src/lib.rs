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

#[cfg(not(test))]
struct SyncCell<T>(UnsafeCell<T>);
#[cfg(not(test))]
unsafe impl<T> Sync for SyncCell<T> {}

struct SurfaceLut {
    initialized: bool,
    height: [[f32; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[f32; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[f32; LUT_LEN]; SURFACE_COUNT],
}

const EMPTY_SURFACE_LUT: SurfaceLut = SurfaceLut {
    initialized: false,
    height: [[0.0; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[0.0; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[1.0; LUT_LEN]; SURFACE_COUNT],
};

#[cfg(not(test))]
static SURFACE_LUT: SyncCell<SurfaceLut> = SyncCell(UnsafeCell::new(EMPTY_SURFACE_LUT));

#[cfg(not(test))]
static MAX_DISPLACEMENT: SyncCell<f32> = SyncCell(UnsafeCell::new(0.0));

#[cfg(not(test))]
static BMP_BUFFER: SyncCell<[u8; MAX_BMP_BYTES]> = SyncCell(UnsafeCell::new([0u8; MAX_BMP_BYTES]));

#[cfg(test)]
std::thread_local! {
    static TEST_SURFACE_LUT: UnsafeCell<SurfaceLut> = const { UnsafeCell::new(EMPTY_SURFACE_LUT) };
    static TEST_MAX_DISPLACEMENT: UnsafeCell<f32> = const { UnsafeCell::new(0.0) };
    static TEST_BMP_BUFFER: UnsafeCell<[u8; MAX_BMP_BYTES]> =
        const { UnsafeCell::new([0u8; MAX_BMP_BYTES]) };
}

#[inline(always)]
fn surface_lut_ptr() -> *mut SurfaceLut {
    #[cfg(test)]
    {
        TEST_SURFACE_LUT.with(|cell| cell.get())
    }
    #[cfg(not(test))]
    {
        SURFACE_LUT.0.get()
    }
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
    let lut = unsafe { &mut *surface_lut_ptr() };
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
    if !unsafe { (*surface_lut_ptr()).initialized } {
        initTables();
    }
    let lut = unsafe { &*surface_lut_ptr() };

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

    fill_pixels(pixel_base, target_w, 0xff80_8080);
    let mut x = 0usize;
    while x < (target_w + 1) / 2 {
        let px = x as f32 + 0.5;
        if px >= scaled_bezel {
            break;
        }
        let disp = sample_disp_lut(disp_lut, px * inv_bezel);
        let sign = if px < half_w { 1.0 } else { -1.0 };
        write_reflected_pixel(pixel_base, target_w, x, sign * disp * inv_max_disp, 0.0);
        x += 1;
    }
}

#[inline(always)]
fn eval_distance_pixel(
    qx: f32,
    qy: f32,
    sign_x: f32,
    sign_y: f32,
    radius: f32,
    scaled_bezel: f32,
    inv_bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) -> (f32, f32) {
    let q_plus_x = qx.max(0.0);
    let q_plus_y = qy.max(0.0);
    let out_len = sqrt_f32(q_plus_x * q_plus_x + q_plus_y * q_plus_y);
    let sd = out_len + qx.max(qy).min(0.0) - radius;
    let depth = -sd;
    if sd >= 0.0 || depth >= scaled_bezel {
        return (0.0, 0.0);
    }
    let disp = sample_disp_lut(disp_lut, depth * inv_bezel) * inv_max_disp;
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

#[inline(always)]
fn column_q(x: usize, half_w: f32, radius: f32) -> f32 {
    let abs_x = (x as f32 + 0.5 - half_w).abs();
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        abs_x - (half_w - radius)
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        abs_x - half_w + radius
    }
}

#[cfg(any(test, all(target_arch = "wasm32", target_feature = "simd128")))]
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
    if sd >= 0.0 || -sd >= scaled_bezel {
        return (0.0, 0.0);
    }
    let disp = sample_disp_lut(disp_lut, -sd * inv_bezel) * inv_max_disp;
    let sign_x = if px < 0.0 {
        -1.0
    } else if px > 0.0 {
        1.0
    } else {
        0.0
    };
    let sign_y = if py < 0.0 {
        -1.0
    } else if py > 0.0 {
        1.0
    } else {
        0.0
    };
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

#[inline]
unsafe fn fill_pixels(row_ptr: *mut u8, count: usize, pixel: u32) {
    let mut x = 0;
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        let packed = u32x4_splat(pixel);
        while x + 4 <= count {
            v128_store(row_ptr.add(x * 4) as *mut v128, packed);
            x += 4;
        }
    }
    while x < count {
        (row_ptr.add(x * 4) as *mut u32).write_unaligned(pixel.to_le());
        x += 1;
    }
}

#[inline(always)]
unsafe fn write_reflected_pixel(row_ptr: *mut u8, width: usize, x: usize, nx: f32, ny: f32) {
    write_bgra_pixel(row_ptr.add(x * 4), nx, ny);
    let reflected = width - 1 - x;
    if reflected != x {
        write_bgra_pixel(row_ptr.add(reflected * 4), -nx, ny);
    }
}

#[inline]
unsafe fn reflect_row(source: *const u8, target: *mut u8, width: usize) {
    let mut x = 0;
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        let green = u32x4_splat(0x0000_ff00);
        let neutral = u32x4_splat(0x0000_8000);
        while x + 4 <= width {
            let pixels = v128_load(source.add(x * 4) as *const v128);
            let mask = i32x4_ne(v128_and(pixels, green), neutral);
            v128_store(
                target.add(x * 4) as *mut v128,
                v128_xor(pixels, v128_and(mask, green)),
            );
            x += 4;
        }
    }
    while x < width {
        let mut pixel = u32::from_le((source.add(x * 4) as *const u32).read_unaligned());
        if pixel & 0xff00 != 0x8000 {
            pixel ^= 0xff00;
        }
        (target.add(x * 4) as *mut u32).write_unaligned(pixel.to_le());
        x += 1;
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline]
unsafe fn write_corner_span(
    row_ptr: *mut u8,
    target_w: usize,
    start: usize,
    end: usize,
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
    let sign_y = if py < 0.0 {
        -1.0
    } else if py > 0.0 {
        1.0
    } else {
        0.0
    };
    let neg_sign_y_v = f32x4_splat(-sign_y);

    let mut x = start;
    while x + 4 <= end {
        let px_v = f32x4_sub(
            f32x4_add(f32x4_splat(x as f32), step_x),
            f32x4_splat(half_w),
        );
        let qx_v = f32x4_sub(f32x4_abs(px_v), inner_x_v);
        let q_plus_x_v = f32x4_max(qx_v, zero);
        let out_len_v = f32x4_sqrt(f32x4_add(f32x4_mul(q_plus_x_v, q_plus_x_v), q_plus_y_sq_v));
        let in_dist_v = f32x4_min(f32x4_max(qx_v, qy_v), zero);
        let sd_v = f32x4_sub(f32x4_add(out_len_v, in_dist_v), radius_v);
        let depth_v = f32x4_neg(sd_v);

        let inside_mask =
            i32x4_bitmask(f32x4_lt(sd_v, zero)) & i32x4_bitmask(f32x4_lt(depth_v, bezel_v));

        if inside_mask == 0 {
            x += 4;
            continue;
        }

        let t_v = f32x4_mul(depth_v, inv_bezel_v);
        let disp_v = f32x4(
            if (inside_mask & 1) != 0 {
                sample_disp_lut(disp_lut, f32x4_extract_lane::<0>(t_v)) * inv_max_disp
            } else {
                0.0
            },
            if (inside_mask & 2) != 0 {
                sample_disp_lut(disp_lut, f32x4_extract_lane::<1>(t_v)) * inv_max_disp
            } else {
                0.0
            },
            if (inside_mask & 4) != 0 {
                sample_disp_lut(disp_lut, f32x4_extract_lane::<2>(t_v)) * inv_max_disp
            } else {
                0.0
            },
            if (inside_mask & 8) != 0 {
                sample_disp_lut(disp_lut, f32x4_extract_lane::<3>(t_v)) * inv_max_disp
            } else {
                0.0
            },
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

        write_reflected_pixel(
            row_ptr,
            target_w,
            x,
            f32x4_extract_lane::<0>(off_x_v),
            f32x4_extract_lane::<0>(off_y_v),
        );
        write_reflected_pixel(
            row_ptr,
            target_w,
            x + 1,
            f32x4_extract_lane::<1>(off_x_v),
            f32x4_extract_lane::<1>(off_y_v),
        );
        write_reflected_pixel(
            row_ptr,
            target_w,
            x + 2,
            f32x4_extract_lane::<2>(off_x_v),
            f32x4_extract_lane::<2>(off_y_v),
        );
        write_reflected_pixel(
            row_ptr,
            target_w,
            x + 3,
            f32x4_extract_lane::<3>(off_x_v),
            f32x4_extract_lane::<3>(off_y_v),
        );

        x += 4;
    }

    while x < end {
        let px = x as f32 + 0.5 - half_w;
        let (off_x, off_y) = eval_distance_pixel(
            column_q(x, half_w, radius),
            qy,
            if px < 0.0 { -1.0 } else { 0.0 },
            sign_y,
            radius,
            scaled_bezel,
            inv_bezel,
            disp_lut,
            inv_max_disp,
        );
        write_reflected_pixel(row_ptr, target_w, x, off_x, off_y);
        x += 1;
    }
}

#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
#[inline]
unsafe fn write_corner_span(
    row_ptr: *mut u8,
    target_w: usize,
    start: usize,
    end: usize,
    py: f32,
    half_w: f32,
    half_h: f32,
    radius: f32,
    scaled_bezel: f32,
    inv_bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    for x in start..end {
        let px = x as f32 + 0.5 - half_w;
        let (nx, ny) = eval_distance_pixel(
            column_q(x, half_w, radius),
            py.abs() - half_h + radius,
            if px < 0.0 { -1.0 } else { 0.0 },
            if py < 0.0 { -1.0 } else { 0.0 },
            radius,
            scaled_bezel,
            inv_bezel,
            disp_lut,
            inv_max_disp,
        );
        write_reflected_pixel(row_ptr, target_w, x, nx, ny);
    }
}

#[inline]
fn first_column_at_most(width: usize, half_w: f32, radius: f32, q: f32) -> usize {
    let limit = (width + 1) / 2;
    let mut x = ((radius - q).max(0.0) as usize).min(limit);
    while x > 0 && column_q(x - 1, half_w, radius) <= q {
        x -= 1;
    }
    while x < limit && column_q(x, half_w, radius) > q {
        x += 1;
    }
    x
}

unsafe fn write_symmetric_map(
    pixel_base: *mut u8,
    width: usize,
    height: usize,
    radius: f32,
    bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    let half_w = width as f32 * 0.5;
    let half_h = height as f32 * 0.5;
    let inv_bezel = 1.0 / bezel.max(1e-4);
    let stride = width * 4;
    let template = pixel_base.add((height / 2) * stride);
    fill_pixels(template, width, 0xff80_8080);
    for x in 0..((bezel as usize + 2).min((width + 1) / 2)) {
        let (nx, _) = eval_distance_pixel(
            column_q(x, half_w, radius),
            -half_w - radius - 1.0,
            if x as f32 + 0.5 < half_w { -1.0 } else { 0.0 },
            0.0,
            radius,
            bezel,
            inv_bezel,
            disp_lut,
            inv_max_disp,
        );
        write_reflected_pixel(template, width, x, nx, 0.0);
    }
    let straight_start = first_column_at_most(width, half_w, radius, 0.0);
    for y in 0..(height + 1) / 2 {
        let py = y as f32 + 0.5 - half_h;
        let qy = py.abs() - half_h + radius;
        let row = pixel_base.add(y * stride);
        if qy <= 0.0 {
            if row != template {
                core::ptr::copy_nonoverlapping(template, row, stride);
            }
            let depth = radius - qy;
            if depth < bezel {
                let start = first_column_at_most(width, half_w, radius, qy);
                let ny = if py < 0.0 {
                    sample_disp_lut(disp_lut, depth * inv_bezel) * inv_max_disp
                } else {
                    0.0
                };
                if start < width - start {
                    let pixel = 0xff80_0080 | ((encode_channel(ny) as u32) << 8);
                    fill_pixels(row.add(start * 4), width - 2 * start, pixel);
                }
            }
        } else {
            fill_pixels(row, width, 0xff80_8080);
            if straight_start < width - straight_start {
                let (_, ny) = eval_distance_pixel(
                    0.0,
                    qy,
                    0.0,
                    -1.0,
                    radius,
                    bezel,
                    inv_bezel,
                    disp_lut,
                    inv_max_disp,
                );
                let pixel = 0xff80_0080 | ((encode_channel(ny) as u32) << 8);
                fill_pixels(
                    row.add(straight_start * 4),
                    width - 2 * straight_start,
                    pixel,
                );
            }
            let outer_x = sqrt_f32((radius * radius - qy * qy).max(0.0));
            let start = ((radius - outer_x).max(0.0) as usize).saturating_sub(2);
            let inner = (radius - bezel).max(0.0);
            let inner_x = sqrt_f32((inner * inner - qy * qy).max(0.0));
            let end = ((radius - inner_x).max(0.0) as usize + 3).min(straight_start);
            write_corner_span(
                row,
                width,
                start.min(end),
                end,
                py,
                half_w,
                half_h,
                radius,
                bezel,
                inv_bezel,
                disp_lut,
                inv_max_disp,
            );
        }
        let reflected_y = height - 1 - y;
        if reflected_y != y {
            let reflected_row = pixel_base.add(reflected_y * stride);
            if width >= 32 && qy <= 0.0 && radius - qy >= bezel {
                core::ptr::copy_nonoverlapping(row, reflected_row, stride);
            } else {
                reflect_row(row, reflected_row, width);
            }
        }
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        for output_y in [y, reflected_y] {
            let output = pixel_base.add(output_y * stride);
            for x in width - width % 4..width {
                let (nx, ny) = eval_scalar_pixel(
                    x as f32 + 0.5 - half_w,
                    output_y as f32 + 0.5 - half_h,
                    half_w,
                    half_h,
                    radius,
                    bezel,
                    inv_bezel,
                    disp_lut,
                    inv_max_disp,
                );
                write_bgra_pixel(output.add(x * 4), nx, ny);
            }
        }
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

        write_symmetric_map(
            pixel_base,
            w,
            h,
            scaled_radius,
            scaled_bezel,
            &disp_lut,
            inv_max_disp,
        );
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

    fn assert_matches_scalar(
        width: i32,
        height: i32,
        radius: f32,
        bezel: f32,
        thickness: f32,
        scale: f32,
        ior: f32,
        surface: i32,
        flags: i32,
    ) {
        let half_w = width as f32 * 0.5;
        let half_h = height as f32 * 0.5;
        let safe_scale = scale.max(1e-4);
        let axis = flags & FLAG_AXIS_X != 0;
        let scaled_bezel = clamp_f32(
            bezel * safe_scale,
            1.0,
            if axis {
                half_w
            } else {
                half_w.min(half_h).max(1.0)
            },
        );
        let scaled_radius = if flags & FLAG_PILL != 0 {
            half_w.min(half_h)
        } else {
            clamp_f32(radius * safe_scale, 0.0, half_w.min(half_h))
        };
        let mut lut = [0.0; LUT_LEN];
        let max_disp = build_refraction_lut(surface, scaled_bezel, thickness, ior, &mut lut);
        let inv_max = 1.0 / max_disp;
        let inv_bezel = 1.0 / scaled_bezel.max(1e-4);
        let len = generateDisplacementBmp(
            width, height, radius, bezel, thickness, scale, ior, surface, flags,
        );
        assert_eq!(len, 64 + width * height * 4);
        assert_eq!(
            read_max_displacement().to_bits(),
            (max_disp / safe_scale).to_bits()
        );
        let bmp = read_bmp_slice(len as usize);
        for y in 0..height {
            for x in 0..width {
                let (nx, ny) = if axis && height == 1 {
                    let px = x as f32 + 0.5;
                    let depth = px.min(width as f32 - px);
                    let nx = if depth < scaled_bezel {
                        let sign = if px < half_w { 1.0 } else { -1.0 };
                        sign * sample_disp_lut(&lut, depth * inv_bezel) * inv_max
                    } else {
                        0.0
                    };
                    (nx, 0.0)
                } else {
                    eval_scalar_pixel(
                        x as f32 + 0.5 - half_w,
                        y as f32 + 0.5 - half_h,
                        half_w,
                        half_h,
                        scaled_radius,
                        scaled_bezel,
                        inv_bezel,
                        &lut,
                        inv_max,
                    )
                };
                let offset = 64 + (y * width + x) as usize * 4;
                let expected = [128, encode_channel(ny), encode_channel(nx), 255];
                for channel in 0..4 {
                    assert!(
                        bmp[offset + channel].abs_diff(expected[channel]) <= 1,
                        "{width}x{height}, radius {radius}, bezel {bezel}, scale {scale}, \
                         surface {surface}, flags {flags}, pixel ({x}, {y}), \
                         actual {:?}, expected {expected:?}",
                        &bmp[offset..offset + 4],
                    );
                }
            }
        }
    }

    #[test]
    fn matches_scalar_for_all_surfaces_flags_and_degenerate_shapes() {
        for (width, height) in [
            (1, 1),
            (1, 9),
            (9, 1),
            (2, 2),
            (3, 5),
            (5, 3),
            (7, 9),
            (16, 17),
            (31, 19),
            (64, 32),
            (65, 33),
            (81, 81),
            (301, 93),
        ] {
            for radius in [0.0, 0.000001, 0.5, 1.0, 3.14159, 12.75, 999.0] {
                for bezel in [0.0, 1.0, 3.125, 999.0] {
                    for surface in 0..4 {
                        for flags in 0..4 {
                            assert_matches_scalar(
                                width, height, radius, bezel, 42.0, 1.0, 2.05, surface, flags,
                            );
                        }
                    }
                }
            }
        }
    }

    #[test]
    fn matches_scalar_for_fractional_scaling_and_signed_refraction() {
        let mut seed = 81281u32;
        let mut random = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            seed as f32 / u32::MAX as f32
        };
        for _ in 0..500 {
            assert_matches_scalar(
                1 + (random() * 100.0) as i32,
                1 + (random() * 100.0) as i32,
                random() * 100.0,
                random() * 100.0,
                random() * 200.0 - 25.0,
                random() * 3.0,
                random() * 4.0,
                (random() * 6.0) as i32 - 1,
                (random() * 8.0) as i32,
            );
        }
    }

    #[test]
    fn handles_capacity_limits_and_rejects_invalid_dimensions() {
        assert_matches_scalar(136_000, 1, 0.0, 18.0, 42.0, 1.0, 2.05, 0, FLAG_AXIS_X);
        assert_matches_scalar(1, 136_000, 0.5, 18.0, 42.0, 1.0, 2.05, 3, FLAG_PILL);
        for (width, height) in [
            (0, 1),
            (1, 0),
            (-1, 1),
            (1, -1),
            (136_001, 1),
            (i32::MAX, i32::MAX),
        ] {
            assert_eq!(
                generateDisplacementBmp(width, height, 0.0, 1.0, 42.0, 1.0, 2.05, 0, 0),
                0
            );
            assert_eq!(read_max_displacement(), 0.0);
        }
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
            assert_eq!(
                i32::from_le_bytes([bmp[22], bmp[23], bmp[24], bmp[25]]),
                -32
            );

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
        let len = generateDisplacementBmp(
            128,
            1,
            20.0,
            18.0,
            60.0,
            1.0,
            2.05,
            0,
            FLAG_PILL | FLAG_AXIS_X,
        );
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
