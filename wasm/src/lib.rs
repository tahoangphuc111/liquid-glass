#![cfg_attr(not(test), no_std)]

use core::cell::UnsafeCell;

const BMP_HEADER_BYTES: usize = 64;
const MAX_BMP_BYTES: usize = BMP_HEADER_BYTES + 136_000 * 4;

const LUT_LEN: usize = 256;
const SURFACE_COUNT: usize = 5;

const SURFACE_CONVEX_SQUIRCLE: i32 = 0;
const SURFACE_CONVEX_CIRCLE: i32 = 1;
const SURFACE_LINEAR: i32 = 2;
const SURFACE_LIP: i32 = 3;
const SURFACE_CONCAVE: i32 = 4;

const FLAG_PILL: i32 = 1;
const FLAG_AXIS_X: i32 = 2;
const FLAG_SQUIRCLE: i32 = 4;
const DIRECTION_HORIZONTAL: i32 = 1;
const DIRECTION_VERTICAL: i32 = 2;

#[cfg(not(test))]
struct SyncCell<T>(UnsafeCell<T>);
#[cfg(not(test))]
unsafe impl<T> Sync for SyncCell<T> {}

struct SurfaceLut {
    initialized: bool,
    taper_mask: [f32; LUT_LEN],
    height: [[f32; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[f32; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[f32; LUT_LEN]; SURFACE_COUNT],
}

const EMPTY_SURFACE_LUT: SurfaceLut = SurfaceLut {
    initialized: false,
    taper_mask: [0.0; LUT_LEN],
    height: [[0.0; LUT_LEN]; SURFACE_COUNT],
    sin_i: [[0.0; LUT_LEN]; SURFACE_COUNT],
    cos_i: [[0.0; LUT_LEN]; SURFACE_COUNT],
};

#[cfg(not(test))]
static SURFACE_LUT: SyncCell<SurfaceLut> = SyncCell(UnsafeCell::new(EMPTY_SURFACE_LUT));

struct CachedRefractionLut {
    valid: bool,
    surface_id: i32,
    bezel_bits: u32,
    thickness_bits: u32,
    ior_bits: u32,
    max_disp: f32,
    disp_lut: [f32; LUT_LEN],
    disp_q_lut: [f32; LUT_LEN],
    disp_q_delta: [f32; LUT_LEN],
}

const EMPTY_CACHED_REFRACTION_LUT: CachedRefractionLut = CachedRefractionLut {
    valid: false,
    surface_id: 0,
    bezel_bits: 0,
    thickness_bits: 0,
    ior_bits: 0,
    max_disp: 0.0,
    disp_lut: [0.0; LUT_LEN],
    disp_q_lut: [0.0; LUT_LEN],
    disp_q_delta: [0.0; LUT_LEN],
};

#[cfg(not(test))]
static CACHED_REFRACTION_LUT: SyncCell<CachedRefractionLut> =
    SyncCell(UnsafeCell::new(EMPTY_CACHED_REFRACTION_LUT));

#[cfg(test)]
std::thread_local! {
    static TEST_CACHED_REFRACTION_LUT: UnsafeCell<CachedRefractionLut> =
        const { UnsafeCell::new(EMPTY_CACHED_REFRACTION_LUT) };
}

#[inline(always)]
fn cached_refraction_lut_ptr() -> *mut CachedRefractionLut {
    #[cfg(test)]
    {
        TEST_CACHED_REFRACTION_LUT.with(|cell| cell.get())
    }
    #[cfg(not(test))]
    {
        CACHED_REFRACTION_LUT.0.get()
    }
}

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
    if value.is_nan() || value < min_val {
        min_val
    } else if value > max_val {
        max_val
    } else {
        value
    }
}

#[inline(always)]
fn sanitize_finite_f32(value: f32, fallback: f32) -> f32 {
    if value.is_finite() {
        value
    } else {
        fallback
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
        SURFACE_CONCAVE => {
            let one_minus_u2 = (1.0 - u * u).max(1e-6);
            let convex_h = sqrt_f32(one_minus_u2);
            let height = (1.0 - convex_h).max(0.0);
            let slope = -(u / convex_h);
            (height, slope)
        }
        _ => (cx, 1.0),
    }
}

#[no_mangle]
pub extern "C" fn initTables() {
    let lut = unsafe { &mut *surface_lut_ptr() };
    if lut.initialized {
        return;
    }
    let inv_steps = 1.0 / ((LUT_LEN - 1) as f32);

    let mut step = 0usize;
    while step < LUT_LEN {
        let s = (step as f32) * inv_steps;
        let t = s * s;
        let fade = clamp_f32((t - 0.90) * 10.0, 0.0, 1.0);
        lut.taper_mask[step] = 1.0 - fade * fade * (3.0 - 2.0 * fade);

        let mut surface_id = 0i32;
        while surface_id < SURFACE_COUNT as i32 {
            let idx = surface_id as usize;
            let (height, slope) = eval_surface_height_and_slope(surface_id, t);
            let norm = sqrt_f32(1.0 + slope * slope);
            lut.height[idx][step] = height;
            lut.sin_i[idx][step] = slope / norm;
            lut.cos_i[idx][step] = 1.0 / norm;
            surface_id += 1;
        }
        step += 1;
    }

    lut.initialized = true;
    unsafe {
        (*cached_refraction_lut_ptr()).valid = false;
    }
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
    let mut i = 0usize;
    let mut max_abs_disp: f32;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        let eta_v = f32x4_splat(eta);
        let scaled_bezel_v = f32x4_splat(scaled_bezel);
        let glass_thickness_v = f32x4_splat(glass_thickness);
        let one_v = f32x4_splat(1.0);
        let min_sin_v = f32x4_splat(-0.999);
        let max_sin_v = f32x4_splat(0.999);
        let min_sq_v = f32x4_splat(1e-6);
        let min_cos_v = f32x4_splat(1e-4);
        let mut max_v = f32x4_splat(0.0);

        let h_ptr = lut.height[safe_surface].as_ptr();
        let sin_ptr = lut.sin_i[safe_surface].as_ptr();
        let cos_ptr = lut.cos_i[safe_surface].as_ptr();
        let mask_ptr = lut.taper_mask.as_ptr();
        let out_ptr = out_disp.as_mut_ptr();

        while i + 4 <= LUT_LEN {
            unsafe {
                let h_v = v128_load(h_ptr.add(i) as *const v128);
                let sin_i_v = v128_load(sin_ptr.add(i) as *const v128);
                let cos_i_v = v128_load(cos_ptr.add(i) as *const v128);
                let mask_v = v128_load(mask_ptr.add(i) as *const v128);

                let sin_t_v = f32x4_min(f32x4_max(f32x4_mul(eta_v, sin_i_v), min_sin_v), max_sin_v);
                let cos_t_v = f32x4_sqrt(f32x4_max(f32x4_sub(one_v, f32x4_mul(sin_t_v, sin_t_v)), min_sq_v));
                let sin_delta_v = f32x4_sub(f32x4_mul(sin_i_v, cos_t_v), f32x4_mul(cos_i_v, sin_t_v));
                let cos_delta_v = f32x4_max(
                    f32x4_add(f32x4_mul(cos_i_v, cos_t_v), f32x4_mul(sin_i_v, sin_t_v)),
                    min_cos_v,
                );
                let depth_v = f32x4_add(f32x4_mul(scaled_bezel_v, h_v), glass_thickness_v);
                let raw_disp_v = f32x4_mul(depth_v, f32x4_div(sin_delta_v, cos_delta_v));
                let disp_v = f32x4_mul(raw_disp_v, mask_v);

                v128_store(out_ptr.add(i) as *mut v128, disp_v);
                max_v = f32x4_max(max_v, f32x4_abs(disp_v));
            }
            i += 4;
        }
        max_abs_disp = f32x4_extract_lane::<0>(max_v)
            .max(f32x4_extract_lane::<1>(max_v))
            .max(f32x4_extract_lane::<2>(max_v))
            .max(f32x4_extract_lane::<3>(max_v));
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        max_abs_disp = 0.0_f32;
    }

    while i < LUT_LEN {
        let h = lut.height[safe_surface][i];
        let sin_i = lut.sin_i[safe_surface][i];
        let cos_i = lut.cos_i[safe_surface][i];
        let mask = lut.taper_mask[i];

        let sin_t = clamp_f32(eta * sin_i, -0.999, 0.999);
        let cos_t = sqrt_f32((1.0 - sin_t * sin_t).max(1e-6));

        let sin_delta = sin_i * cos_t - cos_i * sin_t;
        let cos_delta = (cos_i * cos_t + sin_i * sin_t).max(1e-4);
        let depth = scaled_bezel * h + glass_thickness;
        let disp = depth * (sin_delta / cos_delta) * mask;

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
    let s = sqrt_f32(clamp_f32(t, 0.0, 1.0));
    let scaled = s * ((LUT_LEN - 1) as f32);
    let idx = scaled as usize;
    if idx >= LUT_LEN - 1 {
        return disp_lut[LUT_LEN - 1];
    }
    let frac = scaled - (idx as f32);
    disp_lut[idx] + (disp_lut[idx + 1] - disp_lut[idx]) * frac
}

#[inline(always)]
fn encode_channel(normalized_offset: f32) -> u8 {
    clamp_f32(128.0 + normalized_offset * 127.5, 0.0, 255.0) as u8
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
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))] disp_q_lut: &[f32; LUT_LEN],
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))] disp_q_delta: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    let width_f = target_w as f32;
    let half_w = width_f * 0.5;
    let inv_bezel = 1.0 / scaled_bezel.max(1e-4);

    let mut x = 0usize;
    let limit = (target_w + 1) / 2;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        let raw_bezel_end = if scaled_bezel > 0.5 {
            let approx = (scaled_bezel - 0.5) as usize;
            if (approx as f32) + 0.5 < scaled_bezel {
                approx + 1
            } else {
                approx
            }
        } else {
            0
        };
        let simd_end = raw_bezel_end.min(target_w / 2);
        if simd_end >= 4 {
            let zero = f32x4_splat(0.0);
            let one = f32x4_splat(1.0);
            let four_v = f32x4_splat(4.0);
            let inv_bezel_v = f32x4_splat(inv_bezel);
            let lut_scale_v = f32x4_splat((LUT_LEN - 1) as f32);
            let lut_max_idx_v = i32x4_splat((LUT_LEN - 2) as i32);
            let zero_i = i32x4_splat(0);
            let c128_v = f32x4_splat(128.0);
            let c255_v = f32x4_splat(255.0);
            let base_bgra_v = i32x4_splat(0xff00_8080_u32 as i32);
            let disp_q_ptr = disp_q_lut.as_ptr();
            let disp_q_delta_ptr = disp_q_delta.as_ptr();
            let mut px_v = f32x4(0.5, 1.5, 2.5, 3.5);

            while x + 4 <= simd_end {
                let t_v = f32x4_min(f32x4_mul(px_v, inv_bezel_v), one);
                let s_v = f32x4_sqrt(t_v);
                let scaled_lut_v = f32x4_mul(s_v, lut_scale_v);
                let idx_v = i32x4_max(
                    i32x4_min(i32x4_trunc_sat_f32x4(scaled_lut_v), lut_max_idx_v),
                    zero_i,
                );
                let frac_v = f32x4_sub(scaled_lut_v, f32x4_convert_i32x4(idx_v));
                let idx0 = i32x4_extract_lane::<0>(idx_v) as usize;
                let idx1 = i32x4_extract_lane::<1>(idx_v) as usize;
                let idx2 = i32x4_extract_lane::<2>(idx_v) as usize;
                let idx3 = i32x4_extract_lane::<3>(idx_v) as usize;
                let d0_v = f32x4(
                    *disp_q_ptr.add(idx0),
                    *disp_q_ptr.add(idx1),
                    *disp_q_ptr.add(idx2),
                    *disp_q_ptr.add(idx3),
                );
                let delta_v = f32x4(
                    *disp_q_delta_ptr.add(idx0),
                    *disp_q_delta_ptr.add(idx1),
                    *disp_q_delta_ptr.add(idx2),
                    *disp_q_delta_ptr.add(idx3),
                );
                let disp_q_v = f32x4_add(d0_v, f32x4_mul(delta_v, frac_v));
                let qx_pos_i = i32x4_trunc_sat_f32x4(f32x4_min(
                    f32x4_max(f32x4_add(c128_v, disp_q_v), zero),
                    c255_v,
                ));
                let qx_neg_i = i32x4_trunc_sat_f32x4(f32x4_min(
                    f32x4_max(f32x4_sub(c128_v, disp_q_v), zero),
                    c255_v,
                ));
                let left_bgra = v128_or(base_bgra_v, i32x4_shl(qx_pos_i, 16));
                let right_bgra = v128_or(base_bgra_v, i32x4_shl(qx_neg_i, 16));
                let right_reversed = i32x4_shuffle::<3, 2, 1, 0>(right_bgra, right_bgra);

                core::ptr::write_unaligned(pixel_base.add(x * 4) as *mut v128, left_bgra);
                core::ptr::write_unaligned(
                    pixel_base.add((target_w - 4 - x) * 4) as *mut v128,
                    right_reversed,
                );
                px_v = f32x4_add(px_v, four_v);
                x += 4;
            }
        }
    }

    while x < limit {
        let px = x as f32 + 0.5;
        if px >= scaled_bezel {
            break;
        }
        let disp = sample_disp_lut(disp_lut, px * inv_bezel);
        let sign = if px < half_w {
            1.0
        } else if px > half_w {
            -1.0
        } else {
            0.0
        };
        write_reflected_pixel(pixel_base, target_w, x, sign * disp * inv_max_disp, 0.0);
        x += 1;
    }
    if x < target_w - x {
        fill_pixels(pixel_base.add(x * 4), target_w - 2 * x, 0xff80_8080);
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
    is_squircle: bool,
) -> (f32, f32) {
    let q_plus_x = qx.max(0.0);
    let q_plus_y = qy.max(0.0);
    let (sd, out_len, raw_nx, raw_ny) = if is_squircle && q_plus_x > 0.0 && q_plus_y > 0.0 {
        let x_major = q_plus_x >= q_plus_y;
        let (major, minor) = if x_major {
            (q_plus_x, q_plus_y)
        } else {
            (q_plus_y, q_plus_x)
        };
        let r = minor / major;
        let r2 = r * r;
        let r3 = r * r2;
        let r4 = r2 * r2;
        let m2 = sqrt_f32(1.0 + r4);
        let m4 = sqrt_f32(m2);
        let m3 = m2 * m4;
        let inv_g = 1.0 / sqrt_f32(1.0 + r3 * r3);
        let len = major * m4;
        let sd_val = (len - radius) * (m3 * inv_g);
        let minor_n = r3 * inv_g;
        if x_major {
            (sd_val, len, inv_g, minor_n)
        } else {
            (sd_val, len, minor_n, inv_g)
        }
    } else {
        let len = sqrt_f32(q_plus_x * q_plus_x + q_plus_y * q_plus_y);
        let sd_val = len + qx.max(qy).min(0.0) - radius;
        let inv_len = if len > 1e-5 { 1.0 / len } else { 0.0 };
        (sd_val, len, q_plus_x * inv_len, q_plus_y * inv_len)
    };
    let depth = -sd;
    if sd >= 0.5 || depth >= scaled_bezel {
        return (0.0, 0.0);
    }
    let edge_cov = if sd > -0.5 {
        let t = 0.5 - sd;
        t * t * (3.0 - 2.0 * t)
    } else {
        1.0
    };
    let sample_depth = if depth > 0.0 { depth } else { 0.0 };
    let disp = sample_disp_lut(disp_lut, sample_depth * inv_bezel) * inv_max_disp * edge_cov;
    let (nx, ny) = if out_len > 1e-5 {
        (-sign_x * raw_nx, -sign_y * raw_ny)
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

#[cfg(test)]
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
    is_squircle: bool,
) -> (f32, f32) {
    let abs_x = if px < 0.0 { -px } else { px };
    let abs_y = if py < 0.0 { -py } else { py };
    let qx = abs_x - half_w + radius;
    let qy = abs_y - half_h + radius;
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
    eval_distance_pixel(
        qx,
        qy,
        sign_x,
        sign_y,
        radius,
        scaled_bezel,
        inv_bezel,
        disp_lut,
        inv_max_disp,
        is_squircle,
    )
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
unsafe fn write_corner_span<const IS_SQUIRCLE: bool>(
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
    disp_q_lut: &[f32; LUT_LEN],
    disp_q_delta: &[f32; LUT_LEN],
    inv_max_disp: f32,
) {
    use core::arch::wasm32::*;

    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let four_v = f32x4_splat(4.0);
    let eps_v = f32x4_splat(1e-5);
    let min_scale_v = f32x4_splat(1e-6);
    let radius_v = f32x4_splat(radius);
    let neg_radius_v = f32x4_neg(radius_v);
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

    let half_v = f32x4_splat(0.5);
    let neg_half_v = f32x4_splat(-0.5);
    let three_v = f32x4_splat(3.0);
    let two_v = f32x4_splat(2.0);
    let c128_v = f32x4_splat(128.0);
    let c255_v = f32x4_splat(255.0);
    let zero_i = i32x4_splat(0);
    let base_bgra_v = i32x4_splat(0xff00_0080_u32 as i32);
    let lut_scale_v = f32x4_splat((LUT_LEN - 1) as f32);
    let lut_max_idx_v = i32x4_splat((LUT_LEN - 2) as i32);
    let disp_q_ptr = disp_q_lut.as_ptr();
    let disp_q_delta_ptr = disp_q_delta.as_ptr();

    let simd_end = end.min(target_w / 2);
    let mut x = start;
    let mut px_v = f32x4_sub(
        f32x4_add(f32x4_splat(start as f32), step_x),
        f32x4_splat(half_w),
    );
    while x + 4 <= simd_end {
        let qx_v = f32x4_sub(f32x4_neg(px_v), inner_x_v);
        let q_plus_x_v = f32x4_max(qx_v, zero);

        let (sd_v, out_len_v, raw_nx_v, raw_ny_v) = if IS_SQUIRCLE {
            let x_major_mask = f32x4_ge(q_plus_x_v, q_plus_y_v);
            let major_v = v128_bitselect(q_plus_x_v, q_plus_y_v, x_major_mask);
            let minor_v = v128_bitselect(q_plus_y_v, q_plus_x_v, x_major_mask);
            let safe_major_v = f32x4_max(major_v, min_scale_v);
            let r_v = f32x4_div(minor_v, safe_major_v);
            let r2_v = f32x4_mul(r_v, r_v);
            let r3_v = f32x4_mul(r_v, r2_v);
            let r4_v = f32x4_mul(r2_v, r2_v);
            let m2_v = f32x4_sqrt(f32x4_add(one, r4_v));
            let m4_v = f32x4_sqrt(m2_v);
            let m3_v = f32x4_mul(m2_v, m4_v);
            let inv_g_v = f32x4_div(one, f32x4_sqrt(f32x4_add(one, f32x4_mul(r3_v, r3_v))));
            let len_v = f32x4_mul(major_v, m4_v);
            let sd_sq_v = f32x4_mul(f32x4_sub(len_v, radius_v), f32x4_mul(m3_v, inv_g_v));
            let pos_mask = f32x4_gt(major_v, eps_v);
            let minor_norm_v = f32x4_mul(r3_v, inv_g_v);
            (
                v128_bitselect(sd_sq_v, neg_radius_v, pos_mask),
                len_v,
                v128_bitselect(inv_g_v, minor_norm_v, x_major_mask),
                v128_bitselect(minor_norm_v, inv_g_v, x_major_mask),
            )
        } else {
            let len_v = f32x4_sqrt(f32x4_add(f32x4_mul(q_plus_x_v, q_plus_x_v), q_plus_y_sq_v));
            let sd_val_v = f32x4_sub(len_v, radius_v);
            (sd_val_v, len_v, q_plus_x_v, q_plus_y_v)
        };
        let depth_v = f32x4_neg(sd_v);

        let inside_lane_mask = v128_and(f32x4_lt(sd_v, half_v), f32x4_lt(depth_v, bezel_v));
        if i32x4_bitmask(inside_lane_mask) == 0 {
            px_v = f32x4_add(px_v, four_v);
            x += 4;
            continue;
        }

        let (norm_x_v, norm_y_v) = if IS_SQUIRCLE {
            (raw_nx_v, raw_ny_v)
        } else {
            let inv_norm_v = f32x4_div(one, f32x4_max(out_len_v, eps_v));
            (f32x4_mul(raw_nx_v, inv_norm_v), f32x4_mul(raw_ny_v, inv_norm_v))
        };

        let safe_depth_v = f32x4_max(depth_v, zero);
        let t_v = f32x4_min(f32x4_mul(safe_depth_v, inv_bezel_v), one);
        let s_v = f32x4_sqrt(t_v);
        let scaled_lut_v = f32x4_mul(s_v, lut_scale_v);
        let idx_v = i32x4_max(
            i32x4_min(i32x4_trunc_sat_f32x4(scaled_lut_v), lut_max_idx_v),
            zero_i,
        );
        let frac_v = f32x4_sub(scaled_lut_v, f32x4_convert_i32x4(idx_v));
        let idx0 = i32x4_extract_lane::<0>(idx_v) as usize;
        let idx1 = i32x4_extract_lane::<1>(idx_v) as usize;
        let idx2 = i32x4_extract_lane::<2>(idx_v) as usize;
        let idx3 = i32x4_extract_lane::<3>(idx_v) as usize;
        let d0_v = f32x4(
            *disp_q_ptr.add(idx0),
            *disp_q_ptr.add(idx1),
            *disp_q_ptr.add(idx2),
            *disp_q_ptr.add(idx3),
        );
        let delta_v = f32x4(
            *disp_q_delta_ptr.add(idx0),
            *disp_q_delta_ptr.add(idx1),
            *disp_q_delta_ptr.add(idx2),
            *disp_q_delta_ptr.add(idx3),
        );
        let interp_disp_q_v = f32x4_add(d0_v, f32x4_mul(delta_v, frac_v));
        let disp_q_v = if i32x4_bitmask(f32x4_gt(sd_v, neg_half_v)) != 0 {
            let edge_t_v = f32x4_min(f32x4_max(f32x4_sub(half_v, sd_v), zero), one);
            let edge_cov_v = f32x4_mul(
                f32x4_mul(edge_t_v, edge_t_v),
                f32x4_sub(three_v, f32x4_mul(two_v, edge_t_v)),
            );
            v128_and(f32x4_mul(interp_disp_q_v, edge_cov_v), inside_lane_mask)
        } else {
            v128_and(interp_disp_q_v, inside_lane_mask)
        };

        let corner_mask = f32x4_gt(out_len_v, eps_v);
        let corner_ny_v = f32x4_mul(neg_sign_y_v, norm_y_v);

        let x_edge_mask = f32x4_gt(qx_v, qy_v);
        let edge_nx_v = v128_and(x_edge_mask, one);
        let edge_ny_v = v128_andnot(neg_sign_y_v, x_edge_mask);

        let nx_v = v128_bitselect(norm_x_v, edge_nx_v, corner_mask);
        let ny_v = v128_bitselect(corner_ny_v, edge_ny_v, corner_mask);

        let off_x_q_v = f32x4_mul(nx_v, disp_q_v);
        let off_y_q_v = f32x4_mul(ny_v, disp_q_v);

        let qy_i = i32x4_trunc_sat_f32x4(f32x4_min(f32x4_max(f32x4_add(c128_v, off_y_q_v), zero), c255_v));
        let qx_pos_i = i32x4_trunc_sat_f32x4(f32x4_min(f32x4_max(f32x4_add(c128_v, off_x_q_v), zero), c255_v));
        let qx_neg_i = i32x4_trunc_sat_f32x4(f32x4_min(f32x4_max(f32x4_sub(c128_v, off_x_q_v), zero), c255_v));

        let g_shifted = i32x4_shl(qy_i, 8);
        let left_bgra = v128_or(base_bgra_v, v128_or(g_shifted, i32x4_shl(qx_pos_i, 16)));
        let right_bgra = v128_or(base_bgra_v, v128_or(g_shifted, i32x4_shl(qx_neg_i, 16)));
        let right_reversed = i32x4_shuffle::<3, 2, 1, 0>(right_bgra, right_bgra);

        core::ptr::write_unaligned(row_ptr.add(x * 4) as *mut v128, left_bgra);
        core::ptr::write_unaligned(row_ptr.add((target_w - 4 - x) * 4) as *mut v128, right_reversed);

        px_v = f32x4_add(px_v, four_v);
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
            IS_SQUIRCLE,
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
    is_squircle: bool,
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
            is_squircle,
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

unsafe fn get_or_build_refraction_lut(
    surface_id: i32,
    scaled_bezel: f32,
    glass_thickness: f32,
    ior: f32,
) -> &'static CachedRefractionLut {
    let cache = &mut *cached_refraction_lut_ptr();
    let bezel_bits = scaled_bezel.to_bits();
    let thickness_bits = glass_thickness.to_bits();
    let ior_bits = ior.to_bits();
    if cache.valid
        && cache.surface_id == surface_id
        && cache.bezel_bits == bezel_bits
        && cache.thickness_bits == thickness_bits
        && cache.ior_bits == ior_bits
    {
        return cache;
    }

    let max_disp = build_refraction_lut(
        surface_id,
        scaled_bezel,
        glass_thickness,
        ior,
        &mut cache.disp_lut,
    );
    let inv_max_disp = 1.0 / max_disp;
    let scale_q = inv_max_disp * 127.5;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        let scale_q_v = f32x4_splat(scale_q);
        let src_ptr = cache.disp_lut.as_ptr();
        let dst_ptr = cache.disp_q_lut.as_mut_ptr();
        let mut i = 0usize;
        while i + 4 <= LUT_LEN {
            let v = v128_load(src_ptr.add(i) as *const v128);
            v128_store(dst_ptr.add(i) as *mut v128, f32x4_mul(v, scale_q_v));
            i += 4;
        }
        let delta_ptr = cache.disp_q_delta.as_mut_ptr();
        let mut j = 0usize;
        while j + 4 <= LUT_LEN - 1 {
            let v0 = v128_load(dst_ptr.add(j) as *const v128);
            let v1 = v128_load(dst_ptr.add(j + 1) as *const v128);
            v128_store(delta_ptr.add(j) as *mut v128, f32x4_sub(v1, v0));
            j += 4;
        }
        while j < LUT_LEN - 1 {
            *delta_ptr.add(j) = *dst_ptr.add(j + 1) - *dst_ptr.add(j);
            j += 1;
        }
        *delta_ptr.add(LUT_LEN - 1) = 0.0;
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    {
        let mut i = 0usize;
        while i < LUT_LEN {
            cache.disp_q_lut[i] = cache.disp_lut[i] * scale_q;
            i += 1;
        }
        let mut j = 0usize;
        while j < LUT_LEN - 1 {
            cache.disp_q_delta[j] = cache.disp_q_lut[j + 1] - cache.disp_q_lut[j];
            j += 1;
        }
        cache.disp_q_delta[LUT_LEN - 1] = 0.0;
    }

    cache.valid = true;
    cache.surface_id = surface_id;
    cache.bezel_bits = bezel_bits;
    cache.thickness_bits = thickness_bits;
    cache.ior_bits = ior_bits;
    cache.max_disp = max_disp;
    cache
}

unsafe fn write_symmetric_map(
    pixel_base: *mut u8,
    width: usize,
    height: usize,
    radius: f32,
    bezel: f32,
    disp_lut: &[f32; LUT_LEN],
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))] disp_q_lut: &[f32; LUT_LEN],
    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))] disp_q_delta: &[f32; LUT_LEN],
    inv_max_disp: f32,
    is_squircle: bool,
) {
    let half_w = width as f32 * 0.5;
    let half_h = height as f32 * 0.5;
    let inv_bezel = 1.0 / bezel.max(1e-4);
    let stride = width * 4;
    let template = pixel_base.add((height / 2) * stride);
    let edge_limit = (bezel as usize + 2).min((width + 1) / 2);
    if edge_limit < width - edge_limit {
        fill_pixels(template.add(edge_limit * 4), width - 2 * edge_limit, 0xff80_8080);
    }
    for x in 0..edge_limit {
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
            false,
        );
        write_reflected_pixel(template, width, x, nx, 0.0);
    }
    let straight_start = first_column_at_most(width, half_w, radius, 0.0);
    let inner_r = (radius - bezel).max(0.0);
    let has_inner_arc = inner_r > 0.0;
    let outer_r_limit = if is_squircle {
        let r = radius + 0.72;
        let r2 = r * r;
        r2 * r2
    } else {
        let r = radius + 0.6;
        r * r
    };
    let inner_r_limit = if is_squircle {
        let r2 = inner_r * inner_r;
        r2 * r2
    } else {
        inner_r * inner_r
    };
    let has_middle_straight = straight_start < width - straight_start;

    for y in 0..(height + 1) / 2 {
        let py = y as f32 + 0.5 - half_h;
        let qy = py.abs() - half_h + radius;
        let row = pixel_base.add(y * stride);
        if qy <= 0.0 {
            let depth = radius - qy;
            if depth < bezel {
                let start = first_column_at_most(width, half_w, radius, qy);
                if row != template {
                    if start > 0 && start < width - start {
                        let edge_bytes = start * 4;
                        core::ptr::copy_nonoverlapping(template, row, edge_bytes);
                        core::ptr::copy_nonoverlapping(
                            template.add((width - start) * 4),
                            row.add((width - start) * 4),
                            edge_bytes,
                        );
                    } else {
                        core::ptr::copy_nonoverlapping(template, row, stride);
                    }
                }
                let edge_cov = if depth < 0.5 {
                    let t = 0.5 + depth;
                    t * t * (3.0 - 2.0 * t)
                } else {
                    1.0
                };
                let ny = if py < 0.0 {
                    sample_disp_lut(disp_lut, depth * inv_bezel) * inv_max_disp * edge_cov
                } else {
                    0.0
                };
                if start < width - start {
                    let pixel = 0xff80_0080 | ((encode_channel(ny) as u32) << 8);
                    fill_pixels(row.add(start * 4), width - 2 * start, pixel);
                }
            } else if row != template {
                core::ptr::copy_nonoverlapping(template, row, stride);
            }
        } else {
            if has_middle_straight {
                if straight_start > 0 {
                    fill_pixels(row, straight_start, 0xff80_8080);
                    fill_pixels(row.add((width - straight_start) * 4), straight_start, 0xff80_8080);
                }
                let depth = radius - qy;
                let pixel = if py < 0.0 && depth > -0.5 && depth < bezel {
                    let edge_cov = if depth < 0.5 {
                        let t = 0.5 + depth;
                        t * t * (3.0 - 2.0 * t)
                    } else {
                        1.0
                    };
                    let ny = sample_disp_lut(disp_lut, depth.max(0.0) * inv_bezel)
                        * inv_max_disp
                        * edge_cov;
                    0xff80_0080 | ((encode_channel(ny) as u32) << 8)
                } else {
                    0xff80_8080
                };
                fill_pixels(
                    row.add(straight_start * 4),
                    width - 2 * straight_start,
                    pixel,
                );
            } else {
                fill_pixels(row, width, 0xff80_8080);
            }
            let qy_sq = qy * qy;
            let (start, end) = if is_squircle {
                let qy4 = qy_sq * qy_sq;
                let outer_x = if outer_r_limit > qy4 {
                    sqrt_f32(sqrt_f32(outer_r_limit - qy4))
                } else {
                    0.0
                };
                let s = ((radius - outer_x).max(0.0) as usize).saturating_sub(2);
                let inner_x = if has_inner_arc && inner_r_limit > qy4 {
                    sqrt_f32(sqrt_f32(inner_r_limit - qy4))
                } else {
                    0.0
                };
                let e = ((radius - inner_x).max(0.0) as usize + 3).min(straight_start);
                (s.min(e), e)
            } else {
                let outer_x = if outer_r_limit > qy_sq {
                    sqrt_f32(outer_r_limit - qy_sq)
                } else {
                    0.0
                };
                let s = ((radius - outer_x).max(0.0) as usize).saturating_sub(2);
                let inner_x = if has_inner_arc && inner_r_limit > qy_sq {
                    sqrt_f32(inner_r_limit - qy_sq)
                } else {
                    0.0
                };
                let e = ((radius - inner_x).max(0.0) as usize + 3).min(straight_start);
                (s.min(e), e)
            };
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            if is_squircle {
                write_corner_span::<true>(
                    row,
                    width,
                    start,
                    end,
                    py,
                    half_w,
                    half_h,
                    radius,
                    bezel,
                    inv_bezel,
                    disp_lut,
                    disp_q_lut,
                    disp_q_delta,
                    inv_max_disp,
                );
            } else {
                write_corner_span::<false>(
                    row,
                    width,
                    start,
                    end,
                    py,
                    half_w,
                    half_h,
                    radius,
                    bezel,
                    inv_bezel,
                    disp_lut,
                    disp_q_lut,
                    disp_q_delta,
                    inv_max_disp,
                );
            }
            #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
            write_corner_span(
                row,
                width,
                start,
                end,
                py,
                half_w,
                half_h,
                radius,
                bezel,
                inv_bezel,
                disp_lut,
                inv_max_disp,
                is_squircle,
            );
        }
        let reflected_y = height - 1 - y;
        if reflected_y != y {
            let reflected_row = pixel_base.add(reflected_y * stride);
            if qy <= 0.0 && radius - qy >= bezel {
                if reflected_row != template {
                    core::ptr::copy_nonoverlapping(template, reflected_row, stride);
                }
            } else {
                reflect_row(row, reflected_row, width);
            }
        }
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
#[inline(never)]
unsafe fn sample_disp_q_simd(
    depth_v: core::arch::wasm32::v128,
    inv_bezel_v: core::arch::wasm32::v128,
    disp_q_ptr: *const f32,
    disp_q_delta_ptr: *const f32,
) -> core::arch::wasm32::v128 {
    use core::arch::wasm32::*;
    let one = f32x4_splat(1.0);
    let zero_i = i32x4_splat(0);
    let lut_scale_v = f32x4_splat((LUT_LEN - 1) as f32);
    let lut_max_idx_v = i32x4_splat((LUT_LEN - 2) as i32);
    let t_v = f32x4_min(f32x4_mul(depth_v, inv_bezel_v), one);
    let s_v = f32x4_sqrt(t_v);
    let scaled_lut_v = f32x4_mul(s_v, lut_scale_v);
    let idx_v = i32x4_max(
        i32x4_min(i32x4_trunc_sat_f32x4(scaled_lut_v), lut_max_idx_v),
        zero_i,
    );
    let frac_v = f32x4_sub(scaled_lut_v, f32x4_convert_i32x4(idx_v));
    let idx0 = i32x4_extract_lane::<0>(idx_v) as usize;
    let idx1 = i32x4_extract_lane::<1>(idx_v) as usize;
    let idx2 = i32x4_extract_lane::<2>(idx_v) as usize;
    let idx3 = i32x4_extract_lane::<3>(idx_v) as usize;
    let d0_v = f32x4(
        *disp_q_ptr.add(idx0),
        *disp_q_ptr.add(idx1),
        *disp_q_ptr.add(idx2),
        *disp_q_ptr.add(idx3),
    );
    let delta_v = f32x4(
        *disp_q_delta_ptr.add(idx0),
        *disp_q_delta_ptr.add(idx1),
        *disp_q_delta_ptr.add(idx2),
        *disp_q_delta_ptr.add(idx3),
    );
    f32x4_add(d0_v, f32x4_mul(delta_v, frac_v))
}

unsafe fn write_directional_horizontal_straight_row(
    near_row: *mut u8,
    far_row: *mut u8,
    width: usize,
    straight_limit: usize,
    inv_bezel: f32,
    feather: f32,
    gain: f32,
    lut: &CachedRefractionLut,
) {
    let mut main_idx = 0usize;

    #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
    {
        use core::arch::wasm32::*;
        if straight_limit >= 4 {
            let zero = f32x4_splat(0.0);
            let four_v = f32x4_splat(4.0);
            let inv_bezel_v = f32x4_splat(inv_bezel);
            let feather_v = f32x4_splat(feather);
            let c128_v = f32x4_splat(128.0);
            let c255_v = f32x4_splat(255.0);
            let base_bgra_v = i32x4_splat(0xff00_8080_u32 as i32);
            let disp_q_ptr = lut.disp_q_lut.as_ptr();
            let disp_q_delta_ptr = lut.disp_q_delta.as_ptr();
            let mut depth_v = f32x4(0.5, 1.5, 2.5, 3.5);

            while main_idx + 4 <= straight_limit {
                let disp_q_v = f32x4_mul(
                    sample_disp_q_simd(depth_v, inv_bezel_v, disp_q_ptr, disp_q_delta_ptr),
                    feather_v,
                );
                let qx_pos_i = i32x4_trunc_sat_f32x4(f32x4_min(
                    f32x4_max(f32x4_add(c128_v, disp_q_v), zero),
                    c255_v,
                ));
                let qx_neg_i = i32x4_trunc_sat_f32x4(f32x4_min(
                    f32x4_max(f32x4_sub(c128_v, disp_q_v), zero),
                    c255_v,
                ));
                let left_bgra = v128_or(base_bgra_v, i32x4_shl(qx_pos_i, 16));
                let right_bgra = v128_or(base_bgra_v, i32x4_shl(qx_neg_i, 16));
                let right_reversed = i32x4_shuffle::<3, 2, 1, 0>(right_bgra, right_bgra);

                core::ptr::write_unaligned(near_row.add(main_idx * 4) as *mut v128, left_bgra);
                core::ptr::write_unaligned(
                    near_row.add((width - 4 - main_idx) * 4) as *mut v128,
                    right_reversed,
                );

                depth_v = f32x4_add(depth_v, four_v);
                main_idx += 4;
            }
        }
    }
    #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
    let _ = feather;

    while main_idx < straight_limit {
        let depth = main_idx as f32 + 0.5;
        let displacement = sample_disp_lut(&lut.disp_lut, depth * inv_bezel) * gain;
        *near_row.add(main_idx * 4 + 2) = encode_channel(displacement);
        *near_row.add((width - 1 - main_idx) * 4 + 2) = encode_channel(-displacement);
        main_idx += 1;
    }

    if near_row != far_row && straight_limit > 0 {
        let cap_bytes = straight_limit * 4;
        let right_offset = (width - straight_limit) * 4;
        core::ptr::copy_nonoverlapping(near_row, far_row, cap_bytes);
        core::ptr::copy_nonoverlapping(
            near_row.add(right_offset),
            far_row.add(right_offset),
            cap_bytes,
        );
    }
}

#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
unsafe fn write_directional_horizontal_corner_simd(
    near_row: *mut u8,
    far_row: *mut u8,
    width: usize,
    main_start: usize,
    main_end: usize,
    q_cross: f32,
    radius: f32,
    bezel: f32,
    inv_bezel: f32,
    feather: f32,
    lut: &CachedRefractionLut,
    is_squircle: bool,
) -> usize {
    use core::arch::wasm32::*;

    let mirror_row = near_row != far_row;
    let zero = f32x4_splat(0.0);
    let one = f32x4_splat(1.0);
    let four_v = f32x4_splat(4.0);
    let eps_v = f32x4_splat(1e-5);
    let min_scale_v = f32x4_splat(1e-6);
    let radius_v = f32x4_splat(radius);
    let neg_radius_v = f32x4_neg(radius_v);
    let bezel_v = f32x4_splat(bezel);
    let inv_bezel_v = f32x4_splat(inv_bezel);
    let feather_v = f32x4_splat(feather);
    let q_cross_v = f32x4_splat(q_cross);
    let q_cross_sq_v = f32x4_mul(q_cross_v, q_cross_v);
    let half_v = f32x4_splat(0.5);
    let neg_half_v = f32x4_splat(-0.5);
    let three_v = f32x4_splat(3.0);
    let two_v = f32x4_splat(2.0);
    let c128_v = f32x4_splat(128.0);
    let c255_v = f32x4_splat(255.0);
    let base_bgra_v = i32x4_splat(0xff00_8080_u32 as i32);
    let disp_q_ptr = lut.disp_q_lut.as_ptr();
    let disp_q_delta_ptr = lut.disp_q_delta.as_ptr();

    let mut main_idx = main_start;
    let mut q_main_v = f32x4_sub(
        radius_v,
        f32x4_add(f32x4_splat(main_start as f32), f32x4(0.5, 1.5, 2.5, 3.5)),
    );

    while main_idx + 4 <= main_end {
        let q_plus_x_v = f32x4_max(q_main_v, zero);
        let (sd_v, out_len_v, raw_nx_v) = if is_squircle {
            let x_major_mask = f32x4_ge(q_plus_x_v, q_cross_v);
            let major_v = v128_bitselect(q_plus_x_v, q_cross_v, x_major_mask);
            let minor_v = v128_bitselect(q_cross_v, q_plus_x_v, x_major_mask);
            let safe_major_v = f32x4_max(major_v, min_scale_v);
            let r_v = f32x4_div(minor_v, safe_major_v);
            let r2_v = f32x4_mul(r_v, r_v);
            let r3_v = f32x4_mul(r_v, r2_v);
            let r4_v = f32x4_mul(r2_v, r2_v);
            let m2_v = f32x4_sqrt(f32x4_add(one, r4_v));
            let m4_v = f32x4_sqrt(m2_v);
            let m3_v = f32x4_mul(m2_v, m4_v);
            let inv_g_v = f32x4_div(one, f32x4_sqrt(f32x4_add(one, f32x4_mul(r3_v, r3_v))));
            let len_v = f32x4_mul(major_v, m4_v);
            let sd_sq_v = f32x4_mul(f32x4_sub(len_v, radius_v), f32x4_mul(m3_v, inv_g_v));
            let pos_mask = f32x4_gt(major_v, eps_v);
            let minor_norm_v = f32x4_mul(r3_v, inv_g_v);
            (
                v128_bitselect(sd_sq_v, neg_radius_v, pos_mask),
                len_v,
                v128_bitselect(inv_g_v, minor_norm_v, x_major_mask),
            )
        } else {
            let len_v = f32x4_sqrt(f32x4_add(f32x4_mul(q_plus_x_v, q_plus_x_v), q_cross_sq_v));
            let sd_val_v = f32x4_sub(len_v, radius_v);
            (sd_val_v, len_v, q_plus_x_v)
        };
        let depth_v = f32x4_neg(sd_v);
        let inside_lane_mask = v128_and(f32x4_lt(sd_v, half_v), f32x4_lt(depth_v, bezel_v));
        if i32x4_bitmask(inside_lane_mask) == 0 {
            q_main_v = f32x4_sub(q_main_v, four_v);
            main_idx += 4;
            continue;
        }

        let norm_x_v = if is_squircle {
            raw_nx_v
        } else {
            f32x4_div(raw_nx_v, f32x4_max(out_len_v, eps_v))
        };

        let safe_depth_v = f32x4_max(depth_v, zero);
        let interp_disp_q_v = f32x4_mul(
            sample_disp_q_simd(safe_depth_v, inv_bezel_v, disp_q_ptr, disp_q_delta_ptr),
            feather_v,
        );
        let disp_q_v = if i32x4_bitmask(f32x4_gt(sd_v, neg_half_v)) != 0 {
            let edge_t_v = f32x4_min(f32x4_max(f32x4_sub(half_v, sd_v), zero), one);
            let edge_cov_v = f32x4_mul(
                f32x4_mul(edge_t_v, edge_t_v),
                f32x4_sub(three_v, f32x4_mul(two_v, edge_t_v)),
            );
            v128_and(f32x4_mul(interp_disp_q_v, edge_cov_v), inside_lane_mask)
        } else {
            v128_and(interp_disp_q_v, inside_lane_mask)
        };

        let corner_mask = f32x4_gt(out_len_v, eps_v);
        let x_edge_mask = f32x4_gt(q_main_v, q_cross_v);
        let edge_nx_v = v128_and(x_edge_mask, one);
        let nx_v = v128_bitselect(norm_x_v, edge_nx_v, corner_mask);
        let off_x_q_v = f32x4_mul(nx_v, disp_q_v);

        let qx_pos_i = i32x4_trunc_sat_f32x4(f32x4_min(
            f32x4_max(f32x4_add(c128_v, off_x_q_v), zero),
            c255_v,
        ));
        let qx_neg_i = i32x4_trunc_sat_f32x4(f32x4_min(
            f32x4_max(f32x4_sub(c128_v, off_x_q_v), zero),
            c255_v,
        ));
        let left_bgra = v128_or(base_bgra_v, i32x4_shl(qx_pos_i, 16));
        let right_bgra = v128_or(base_bgra_v, i32x4_shl(qx_neg_i, 16));
        let right_reversed = i32x4_shuffle::<3, 2, 1, 0>(right_bgra, right_bgra);

        let left_offset = main_idx * 4;
        let right_offset = (width - 4 - main_idx) * 4;
        core::ptr::write_unaligned(near_row.add(left_offset) as *mut v128, left_bgra);
        core::ptr::write_unaligned(near_row.add(right_offset) as *mut v128, right_reversed);
        if mirror_row {
            core::ptr::write_unaligned(far_row.add(left_offset) as *mut v128, left_bgra);
            core::ptr::write_unaligned(far_row.add(right_offset) as *mut v128, right_reversed);
        }

        q_main_v = f32x4_sub(q_main_v, four_v);
        main_idx += 4;
    }

    main_idx
}

unsafe fn write_directional_map(
    pixel_base: *mut u8,
    width: usize,
    height: usize,
    radius: f32,
    bezel: f32,
    lut: &CachedRefractionLut,
    is_squircle: bool,
    vertical: bool,
    edge_fade: f32,
) {
    let (main_len, cross_len, main_stride, cross_stride) = if vertical {
        (height, width, width, 1)
    } else {
        (width, height, 1, width)
    };
    let half_cross = cross_len as f32 * 0.5;
    let cap_end = ((radius.max(bezel) + 1.0) as usize).min(main_len / 2);
    let inv_bezel = 1.0 / bezel.max(1e-4);
    let inv_max_disp = 1.0 / lut.max_disp;
    let fade_len = (half_cross * edge_fade - 0.5).max(1.0);
    let inv_fade = 1.0 / fade_len;
    let channel = if vertical { 1 } else { 2 };

    fill_pixels(pixel_base, width * height, 0xff80_8080);
    if cap_end == 0 || cross_len < 2 {
        return;
    }

    let straight_bezel_end = if bezel > 0.5 {
        let approx = (bezel - 0.5) as usize;
        let limit = if (approx as f32) + 0.5 < bezel {
            approx + 1
        } else {
            approx
        };
        limit.min(cap_end)
    } else {
        0
    };

    let corner_main_end = if radius > 0.5 {
        let approx = (radius - 0.5) as usize;
        let limit = if (approx as f32) + 0.5 < radius {
            approx + 1
        } else {
            approx
        };
        limit.min(cap_end)
    } else {
        0
    };

    let inner_r = (radius - bezel).max(0.0);
    let has_inner_arc = inner_r > 0.0;
    let outer_radius_limit = if is_squircle {
        let r = radius + 0.72;
        let r2 = r * r;
        r2 * r2
    } else {
        let r = radius + 0.6;
        r * r
    };
    let inner_radius_limit = if is_squircle {
        let r2 = inner_r * inner_r;
        r2 * r2
    } else {
        inner_r * inner_r
    };

    let cross_limit = (cross_len + 1) / 2;
    let mut flat_cross_start = straight_bezel_end.max(1).max(fade_len as usize);
    if radius > 0.5 {
        flat_cross_start = flat_cross_start.max((radius - 0.5) as usize);
    }
    while flat_cross_start < cross_limit
        && (radius - (flat_cross_start as f32 + 0.5) > 0.0
            || (flat_cross_start as f32) * inv_fade < 1.0)
    {
        flat_cross_start += 1;
    }
    let varied_cross_end = flat_cross_start.min(cross_limit);

    for cross_idx in 1..varied_cross_end {
        let t = (cross_idx as f32 * inv_fade).min(1.0);
        let feather = t * t * t * (t * (6.0 * t - 15.0) + 10.0);
        let gain = feather * inv_max_disp;
        let near = cross_idx * cross_stride;
        let far = (cross_len - 1 - cross_idx) * cross_stride;
        let q_cross = radius - (cross_idx as f32 + 0.5);

        if q_cross <= 0.0 {
            let straight_limit = straight_bezel_end.min(cross_idx);
            if !vertical {
                write_directional_horizontal_straight_row(
                    pixel_base.add(near * 4),
                    pixel_base.add(far * 4),
                    width,
                    straight_limit,
                    inv_bezel,
                    feather,
                    gain,
                    lut,
                );
            } else {
                for main_idx in 0..straight_limit {
                    let displacement =
                        sample_disp_lut(&lut.disp_lut, (main_idx as f32 + 0.5) * inv_bezel) * gain;
                    let low = main_idx * main_stride;
                    let high = (main_len - 1 - main_idx) * main_stride;
                    let pos_byte = encode_channel(displacement);
                    let neg_byte = encode_channel(-displacement);
                    *pixel_base.add((near + low) * 4 + channel) = pos_byte;
                    *pixel_base.add((near + high) * 4 + channel) = neg_byte;
                    if near != far {
                        *pixel_base.add((far + low) * 4 + channel) = pos_byte;
                        *pixel_base.add((far + high) * 4 + channel) = neg_byte;
                    }
                }
            }
            continue;
        }

        if corner_main_end == 0 {
            continue;
        }
        let q_cross_sq = q_cross * q_cross;
        let (main_start, main_end) = if is_squircle {
            let q_cross_4 = q_cross_sq * q_cross_sq;
            let outer_x = if outer_radius_limit > q_cross_4 {
                sqrt_f32(sqrt_f32(outer_radius_limit - q_cross_4))
            } else {
                0.0
            };
            let start = ((radius - outer_x).max(0.0) as usize).saturating_sub(2);
            let inner_x = if has_inner_arc && inner_radius_limit > q_cross_4 {
                sqrt_f32(sqrt_f32(inner_radius_limit - q_cross_4))
            } else {
                0.0
            };
            let end = ((radius - inner_x).max(0.0) as usize + 3).min(corner_main_end);
            (start.min(end), end)
        } else {
            let outer_x = if outer_radius_limit > q_cross_sq {
                sqrt_f32(outer_radius_limit - q_cross_sq)
            } else {
                0.0
            };
            let start = ((radius - outer_x).max(0.0) as usize).saturating_sub(2);
            let inner_x = if has_inner_arc && inner_radius_limit > q_cross_sq {
                sqrt_f32(inner_radius_limit - q_cross_sq)
            } else {
                0.0
            };
            let end = ((radius - inner_x).max(0.0) as usize + 3).min(corner_main_end);
            (start.min(end), end)
        };
        if main_start >= main_end {
            continue;
        }

        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        let scalar_start = if !vertical && main_end - main_start >= 4 {
            write_directional_horizontal_corner_simd(
                pixel_base.add(near * 4),
                pixel_base.add(far * 4),
                width,
                main_start,
                main_end,
                q_cross,
                radius,
                bezel,
                inv_bezel,
                feather,
                lut,
                is_squircle,
            )
        } else {
            main_start
        };
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        let scalar_start = main_start;

        for main_idx in scalar_start..main_end {
            let q_main = radius - (main_idx as f32 + 0.5);
            let (displacement, _) = eval_distance_pixel(
                q_main,
                q_cross,
                -1.0,
                0.0,
                radius,
                bezel,
                inv_bezel,
                &lut.disp_lut,
                gain,
                is_squircle,
            );
            let low = main_idx * main_stride;
            let high = (main_len - 1 - main_idx) * main_stride;
            let pos_byte = encode_channel(displacement);
            let neg_byte = encode_channel(-displacement);
            *pixel_base.add((near + low) * 4 + channel) = pos_byte;
            *pixel_base.add((near + high) * 4 + channel) = neg_byte;
            if near != far {
                *pixel_base.add((far + low) * 4 + channel) = pos_byte;
                *pixel_base.add((far + high) * 4 + channel) = neg_byte;
            }
        }
    }

    if flat_cross_start < cross_limit && straight_bezel_end > 0 {
        if !vertical {
            let row_stride_bytes = width * 4;
            let cap_bytes = straight_bezel_end * 4;
            let right_cap_offset = (width - straight_bezel_end) * 4;
            let template_row = pixel_base.add(flat_cross_start * row_stride_bytes);
            let first_far_idx = cross_len - 1 - flat_cross_start;
            let first_far_row = pixel_base.add(first_far_idx * row_stride_bytes);
            write_directional_horizontal_straight_row(
                template_row,
                first_far_row,
                width,
                straight_bezel_end,
                inv_bezel,
                1.0,
                inv_max_disp,
                lut,
            );
            for cross_idx in (flat_cross_start + 1)..cross_limit {
                let near_row = pixel_base.add(cross_idx * row_stride_bytes);
                core::ptr::copy_nonoverlapping(template_row, near_row, cap_bytes);
                core::ptr::copy_nonoverlapping(
                    template_row.add(right_cap_offset),
                    near_row.add(right_cap_offset),
                    cap_bytes,
                );
                let far_idx = cross_len - 1 - cross_idx;
                if far_idx != cross_idx {
                    let far_row = pixel_base.add(far_idx * row_stride_bytes);
                    core::ptr::copy_nonoverlapping(template_row, far_row, cap_bytes);
                    core::ptr::copy_nonoverlapping(
                        template_row.add(right_cap_offset),
                        far_row.add(right_cap_offset),
                        cap_bytes,
                    );
                }
            }
        } else {
            let span_count = width - 2 * flat_cross_start;
            for main_idx in 0..straight_bezel_end {
                let displacement =
                    sample_disp_lut(&lut.disp_lut, (main_idx as f32 + 0.5) * inv_bezel)
                        * inv_max_disp;
                let top_pixel = 0xff80_0080 | ((encode_channel(displacement) as u32) << 8);
                let bottom_pixel = 0xff80_0080 | ((encode_channel(-displacement) as u32) << 8);
                fill_pixels(
                    pixel_base.add((main_idx * width + flat_cross_start) * 4),
                    span_count,
                    top_pixel,
                );
                fill_pixels(
                    pixel_base.add(((height - 1 - main_idx) * width + flat_cross_start) * 4),
                    span_count,
                    bottom_pixel,
                );
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
    generateDirectionalDisplacementBmp(
        target_w,
        target_h,
        radius,
        clamped_bezel,
        glass_thickness,
        scale_factor,
        ior,
        surface_id,
        flags,
        0,
        0.0,
    )
}

#[no_mangle]
pub extern "C" fn generateDirectionalDisplacementBmp(
    target_w: i32,
    target_h: i32,
    radius: f32,
    clamped_bezel: f32,
    glass_thickness: f32,
    scale_factor: f32,
    ior: f32,
    surface_id: i32,
    flags: i32,
    direction: i32,
    edge_fade: f32,
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

    let safe_scale = sanitize_finite_f32(scale_factor, 1.0).max(1e-4);
    let safe_radius = sanitize_finite_f32(radius, 0.0);
    let safe_bezel = sanitize_finite_f32(clamped_bezel, 14.0);
    let safe_thickness = sanitize_finite_f32(glass_thickness, 48.0);
    let safe_ior = sanitize_finite_f32(ior, 1.49);
    let half_w = (w as f32) * 0.5;
    let half_h = (h as f32) * 0.5;
    let half_min = if half_w < half_h { half_w } else { half_h };

    let is_pill = (flags & FLAG_PILL) != 0;
    let is_axis_x = (flags & FLAG_AXIS_X) != 0;
    let is_squircle = (flags & FLAG_SQUIRCLE) != 0;

    let scaled_bezel = if is_axis_x {
        clamp_f32(safe_bezel * safe_scale, 1.0, half_w.max(1.0))
    } else {
        clamp_f32(safe_bezel * safe_scale, 1.0, half_min.max(1.0))
    };
    // Leave headroom for the 1e-4 cosine floor and conversion back to CSS pixels.
    let thickness_limit = (f32::MAX / 16_384.0) * safe_scale.min(1.0);
    let scaled_thickness = clamp_f32(
        safe_thickness * safe_scale,
        -thickness_limit,
        thickness_limit,
    );

    let scaled_radius = if is_pill {
        half_min
    } else {
        clamp_f32(safe_radius * safe_scale, 0.0, half_min)
    };

    unsafe {
        let cached = get_or_build_refraction_lut(
            surface_id,
            scaled_bezel,
            scaled_thickness,
            safe_ior,
        );
        let max_disp_target = cached.max_disp;
        let inv_max_disp = 1.0 / max_disp_target;
        let max_displacement_css = max_disp_target / safe_scale;

        write_max_displacement(max_displacement_css);
        let bmp_ptr = bmp_buffer_ptr();
        write_bmp_header(bmp_ptr, target_w, target_h, pixel_bytes as u32);
        let pixel_base = bmp_ptr.add(BMP_HEADER_BYTES);

        if is_axis_x && h == 1 {
            write_axis_x_strip(
                pixel_base,
                w,
                scaled_bezel,
                &cached.disp_lut,
                #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
                &cached.disp_q_lut,
                #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
                &cached.disp_q_delta,
                inv_max_disp,
            );
            return total_bytes as i32;
        }

        if direction == DIRECTION_HORIZONTAL || direction == DIRECTION_VERTICAL {
            write_directional_map(
                pixel_base,
                w,
                h,
                scaled_radius,
                scaled_bezel,
                cached,
                is_squircle && scaled_radius > 0.0,
                direction == DIRECTION_VERTICAL,
                clamp_f32(sanitize_finite_f32(edge_fade, 0.35), 0.0, 1.0),
            );
            return total_bytes as i32;
        }

        write_symmetric_map(
            pixel_base,
            w,
            h,
            scaled_radius,
            scaled_bezel,
            &cached.disp_lut,
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            &cached.disp_q_lut,
            #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
            &cached.disp_q_delta,
            inv_max_disp,
            is_squircle && scaled_radius > 0.0,
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
                half_w.max(1.0)
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
        let max_disp =
            build_refraction_lut(surface, scaled_bezel, thickness * safe_scale, ior, &mut lut);
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
                        let sign = if px < half_w {
                            1.0
                        } else if px > half_w {
                            -1.0
                        } else {
                            0.0
                        };
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
                        (flags & FLAG_SQUIRCLE) != 0 && scaled_radius > 0.0,
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
                    for surface in 0..SURFACE_COUNT as i32 {
                        for flags in 0..8 {
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
                (random() * 7.0) as i32 - 1,
                (random() * 12.0) as i32,
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
        for surface_id in 0..SURFACE_COUNT as i32 {
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
            if surface_id == SURFACE_CONCAVE {
                assert!(bmp[left + 2] < 128);
                assert!(bmp[right + 2] > 128);
            } else {
                assert!(bmp[left + 2] > 128);
                assert!(bmp[right + 2] < 128);
            }
        }
    }

    #[test]
    fn squircle_corners_match_scalar_and_soften_corner_norm() {
        assert_matches_scalar(64, 64, 24.0, 14.0, 42.0, 1.0, 2.05, 0, FLAG_SQUIRCLE);
        initTables();
        let len_circ = generateDisplacementBmp(64, 64, 24.0, 14.0, 42.0, 1.0, 2.05, 0, 0);
        let circ_bmp = read_bmp_slice(len_circ as usize).to_vec();
        let len_sq =
            generateDisplacementBmp(64, 64, 24.0, 14.0, 42.0, 1.0, 2.05, 0, FLAG_SQUIRCLE);
        let sq_bmp = read_bmp_slice(len_sq as usize);
        let corner_sample = 64 + (4 * 64 + 4) * 4;
        assert_ne!(&circ_bmp[corner_sample..corner_sample + 4], &sq_bmp[corner_sample..corner_sample + 4]);
    }

    #[test]
    fn narrows_directional_displacement_to_the_caps_on_a_small_lens() {
        let (w, h) = (80, 20);
        let len = generateDirectionalDisplacementBmp(
            w, h, 0.0, 6.0, 28.0, 1.0, 1.48,
            SURFACE_CONVEX_SQUIRCLE, FLAG_PILL, DIRECTION_HORIZONTAL, 0.35,
        );
        let bmp = read_bmp_slice(len as usize);
        let red = |x, y| bmp[BMP_HEADER_BYTES + ((y * w + x) * 4 + 2) as usize];
        assert!(red(1, h / 2) > 150);
        assert!(red(w - 2, h / 2) < 105);
        assert_eq!(red(w / 2, 0), 128);
        assert_eq!(red(1, 0), 128);
        assert_eq!(red(1, h - 1), 128);
        assert!(bmp[BMP_HEADER_BYTES..].chunks_exact(4).all(|p| p[1] == 128));
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

    #[test]
    fn sanitizes_nan_inputs_without_corrupting_bmp() {
        initTables();
        assert_eq!(clamp_f32(f32::NAN, 1.0, 5.0), 1.0);
        let len = generateDisplacementBmp(
            48,
            24,
            f32::NAN,
            f32::NAN,
            f32::NAN,
            f32::NAN,
            f32::NAN,
            0,
            0,
        );
        assert_eq!(len, 64 + 48 * 24 * 4);
        assert!(read_max_displacement().is_finite() && read_max_displacement() > 0.0);
    }

    #[test]
    fn tapers_inner_bezel_boundary_smoothly_to_zero() {
        initTables();
        for surface_id in 0..SURFACE_COUNT as i32 {
            let mut lut = [1.0_f32; LUT_LEN];
            build_refraction_lut(surface_id, 14.0, 48.0, 2.15, &mut lut);
            assert!(
                lut[LUT_LEN - 1].abs() < 1e-6,
                "surface {surface_id} end displacement {} did not taper to 0",
                lut[LUT_LEN - 1]
            );
        }
    }

    #[test]
    fn duffy_transform_achieves_high_rim_accuracy() {
        initTables();
        let bezel = 14.0_f32;
        let thickness = 48.0_f32;
        let ior = 2.15_f32;
        let eta = 1.0 / ior;
        for surface_id in [SURFACE_CONVEX_SQUIRCLE, SURFACE_CONVEX_CIRCLE] {
            let mut lut = [0.0_f32; LUT_LEN];
            let max_disp = build_refraction_lut(surface_id, bezel, thickness, ior, &mut lut);
            for t in [0.004_f32, 0.015_f32, 0.05_f32, 0.25_f32] {
                let (h, slope) = eval_surface_height_and_slope(surface_id, t);
                let norm = sqrt_f32(1.0 + slope * slope);
                let sin_i = slope / norm;
                let cos_i = 1.0 / norm;
                let sin_t = clamp_f32(eta * sin_i, -0.999, 0.999);
                let cos_t = sqrt_f32((1.0 - sin_t * sin_t).max(1e-6));
                let sin_d = sin_i * cos_t - cos_i * sin_t;
                let cos_d = (cos_i * cos_t + sin_i * sin_t).max(1e-4);
                let exact = (bezel * h + thickness) * (sin_d / cos_d);
                let sampled = sample_disp_lut(&lut, t);
                let rel_err = (sampled - exact).abs() / max_disp;
                assert!(
                    rel_err < 2e-3,
                    "surface {surface_id} at t={t}: sampled={sampled}, exact={exact}, rel_err={rel_err}"
                );
            }
        }
    }

    #[test]
    fn caches_refraction_lut_and_invalidates_on_parameter_change() {
        initTables();
        unsafe {
            let first = get_or_build_refraction_lut(SURFACE_CONVEX_SQUIRCLE, 14.0, 48.0, 1.5);
            let first_max = first.max_disp;
            let first_mid = first.disp_lut[128];
            let first_q_mid = first.disp_q_lut[128];

            let cached = get_or_build_refraction_lut(SURFACE_CONVEX_SQUIRCLE, 14.0, 48.0, 1.5);
            assert_eq!(cached.max_disp.to_bits(), first_max.to_bits());
            assert_eq!(cached.disp_lut[128].to_bits(), first_mid.to_bits());
            assert_eq!(cached.disp_q_lut[128].to_bits(), first_q_mid.to_bits());

            let changed_ior = get_or_build_refraction_lut(SURFACE_CONVEX_SQUIRCLE, 14.0, 48.0, 2.05);
            assert_ne!(changed_ior.max_disp.to_bits(), first_max.to_bits());

            let changed_surface =
                get_or_build_refraction_lut(SURFACE_CONCAVE, 14.0, 48.0, 2.05);
            assert!(changed_surface.disp_lut[128] < 0.0);
        }
    }

    #[test]
    fn directional_map_matches_scalar_reference_across_shapes_and_orientations() {
        initTables();
        let assert_directional_matches = |width: i32,
                                          height: i32,
                                          radius: f32,
                                          bezel: f32,
                                          thickness: f32,
                                          scale: f32,
                                          ior: f32,
                                          surface: i32,
                                          flags: i32,
                                          direction: i32,
                                          edge_fade: f32| {
            let safe_scale = scale.max(1e-4);
            let w = width as usize;
            let h = height as usize;
            let half_min = (w as f32 * 0.5).min(h as f32 * 0.5);
            let scaled_bezel = clamp_f32(bezel * safe_scale, 1.0, half_min.max(1.0));
            let scaled_radius = if flags & FLAG_PILL != 0 {
                half_min
            } else {
                clamp_f32(radius * safe_scale, 0.0, half_min)
            };
            let is_squircle = (flags & FLAG_SQUIRCLE) != 0 && scaled_radius > 0.0;
            let vertical = direction == DIRECTION_VERTICAL;
            let safe_fade = clamp_f32(edge_fade, 0.0, 1.0);

            let mut lut = [0.0_f32; LUT_LEN];
            let max_disp =
                build_refraction_lut(surface, scaled_bezel, thickness * safe_scale, ior, &mut lut);
            let inv_bezel = 1.0 / scaled_bezel.max(1e-4);
            let inv_max_disp = 1.0 / max_disp;

            let mut expected = vec![0u8; w * h * 4];
            for px in expected.chunks_exact_mut(4) {
                px.copy_from_slice(&[128, 128, 128, 255]);
            }
            let (main_len, cross_len, main_stride, cross_stride) = if vertical {
                (h, w, w, 1)
            } else {
                (w, h, 1, w)
            };
            let cap_end = ((scaled_radius.max(scaled_bezel) + 1.0) as usize).min(main_len / 2);
            let inv_fade = 1.0 / (cross_len as f32 * 0.5 * safe_fade - 0.5).max(1.0);
            let channel = if vertical { 1 } else { 2 };
            for c in 1..(cross_len + 1) / 2 {
                let t = (c as f32 * inv_fade).min(1.0);
                let feather = t * t * t * (t * (6.0 * t - 15.0) + 10.0);
                let gain = feather * inv_max_disp;
                let near = c * cross_stride;
                let far = (cross_len - 1 - c) * cross_stride;
                let q_cross = scaled_radius - (c as f32 + 0.5);
                for m in 0..cap_end {
                    let q_main = scaled_radius - (m as f32 + 0.5);
                    if q_main <= 0.0 && q_main <= q_cross {
                        break;
                    }
                    let (displacement, _) = eval_distance_pixel(
                        q_main,
                        q_cross,
                        -1.0,
                        0.0,
                        scaled_radius,
                        scaled_bezel,
                        inv_bezel,
                        &lut,
                        gain,
                        is_squircle,
                    );
                    let low = m * main_stride;
                    let high = (main_len - 1 - m) * main_stride;
                    let pos_byte = encode_channel(displacement);
                    let neg_byte = encode_channel(-displacement);
                    expected[(near + low) * 4 + channel] = pos_byte;
                    expected[(near + high) * 4 + channel] = neg_byte;
                    if near != far {
                        expected[(far + low) * 4 + channel] = pos_byte;
                        expected[(far + high) * 4 + channel] = neg_byte;
                    }
                }
            }

            let len = generateDirectionalDisplacementBmp(
                width, height, radius, bezel, thickness, scale, ior, surface, flags, direction,
                edge_fade,
            );
            assert_eq!(len as usize, BMP_HEADER_BYTES + w * h * 4);
            let actual = &read_bmp_slice(len as usize)[BMP_HEADER_BYTES..];
            for idx in 0..actual.len() {
                assert!(
                    actual[idx].abs_diff(expected[idx]) <= 1,
                    "mismatch at byte {idx} for {width}x{height} r={radius} b={bezel} flags={flags} dir={direction} fade={edge_fade}: actual={} expected={}",
                    actual[idx],
                    expected[idx]
                );
            }
        };

        for (width, height) in [(1, 1), (2, 2), (7, 9), (16, 17), (64, 24), (25, 65), (96, 48)] {
            for radius in [0.0, 0.5, 4.25, 16.0, 999.0] {
                for bezel in [1.0, 4.5, 12.0, 999.0] {
                    for flags in [0, FLAG_PILL, FLAG_SQUIRCLE, FLAG_PILL | FLAG_SQUIRCLE] {
                        for direction in [DIRECTION_HORIZONTAL, DIRECTION_VERTICAL] {
                            for fade in [0.0, 0.25, 0.35, 1.0] {
                                assert_directional_matches(
                                    width,
                                    height,
                                    radius,
                                    bezel,
                                    36.0,
                                    1.0,
                                    1.55,
                                    SURFACE_CONVEX_SQUIRCLE,
                                    flags,
                                    direction,
                                    fade,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}
