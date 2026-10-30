#![cfg(feature = "cpu")]
use burn::tensor::{Device, Tensor, TensorData};
use dinodreamer_engine::{
    image::{
        Canvas, GRID, JITTER_RADIUS, Jitter, LEVELS, MAX_ZOOM_PER_UPDATE, Pyramid, Random, SIZE, Zoom,
        Resample, resize_coefficients, zoom_coefficients,
    },
};

#[test]
fn bicubic_preserves_constant_images_and_edge_weights() {
    let device = Device::flex().autodiff();
    for side in [3, 16, 32, 64, 128, 256] {
        let coefficients = resize_coefficients(side, 256);
        for row in coefficients.chunks_exact(side) {
            assert!((row.iter().sum::<f32>() - 1.0).abs() < 1e-5);
        }
        let input = Tensor::<4>::ones([1, 1, side, side], &device).require_grad();
        let output = Resample::new(&coefficients, side, &device).apply(input.clone());
        let gradients = output.clone().sum().backward();
        assert!((input.grad(&gradients).unwrap().sum().into_scalar::<f32>() - 65536.0).abs() < 1.0);
        assert!((output.mean().into_scalar::<f32>() - 1.0).abs() < 1e-5);
    }
}

#[test]
fn seed_reproduces_all_five_arrays() {
    let device = Device::flex().autodiff();
    let first = Pyramid::new(0, &device);
    let second = Pyramid::new(0, &device);
    assert_eq!(first.levels.len(), LEVELS.len());
    for (a, b) in first.levels.into_iter().zip(second.levels) {
        assert_eq!(
            a.into_data().try_to_vec::<f32>().unwrap(),
            b.into_data().try_to_vec::<f32>().unwrap()
        );
    }
}

#[test]
fn jitter_index_stays_in_bounds_at_float_rounding_boundary() {
    // This seed produces u32::MAX on the first xorshift update. Its FP32
    // uniform value rounds to 1.0 rather than a value strictly below one.
    let mut random = Random::new(1_584_200_934);
    assert_eq!(random.offset(JITTER_RADIUS), 2 * JITTER_RADIUS);
}

fn values(tensor: Tensor<4>) -> Vec<f32> {
    tensor.into_data().try_to_vec::<f32>().unwrap()
}

#[test]
fn rebase_reproduces_the_image_and_protected_pixels_copy_the_base() {
    let device = Device::flex().autodiff();
    let mut canvas = Canvas::from_seed(3, vec![true; GRID * GRID], &device);
    let before = values(canvas.compose());
    let mut editable = vec![true; GRID * GRID];
    editable[0] = false; // Pixels 0..16 × 0..16.
    canvas.rebase(editable);
    let after = values(canvas.compose());
    let error = before.iter().zip(&after).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
    assert!(error <= 1.1e-5, "rebase error {error}");

    // Move every parameter; the protected cell must still show the base exactly.
    for level in &mut canvas.pyramid.levels {
        *level = (level.clone().inner() + 1.0).autodiff().require_grad();
    }
    let image = canvas.compose();
    let moved = values(image.clone());
    let pixel = |row: usize, column: usize| row * SIZE + column;
    assert_eq!(moved[pixel(3, 5)], after[pixel(3, 5)]);
    assert_ne!(moved[pixel(3, 40)], after[pixel(3, 40)]);
    let gradients = image.sum().backward();
    let finest = values(canvas.pyramid.levels[4].grad(&gradients).unwrap().autodiff());
    assert_eq!(finest[pixel(3, 5)], 0.0);
    assert!(finest[pixel(3, 40)] > 0.0);
}

#[test]
fn a_two_pixel_shift_keeps_every_patch_center_in_its_patch() {
    // Measured slots are the same in both views.
    let device = Device::flex();
    let mut patch_index = vec![0f32; 3 * SIZE * SIZE];
    for row in 0..SIZE {
        for column in 0..SIZE {
            patch_index[row * SIZE + column] = (row / 16) as f32;
            patch_index[SIZE * SIZE + row * SIZE + column] = (column / 16) as f32;
        }
    }
    let image = Tensor::<4>::from_data(TensorData::new(patch_index, [1, 3, SIZE, SIZE]), &device);
    let jitter = Jitter::new(0, JITTER_RADIUS, &device);
    let radius = JITTER_RADIUS as i32;
    for row_shift in -radius..=radius {
        for column_shift in -radius..=radius {
            let shifted = values(jitter.fixed_views(image.clone(), row_shift, column_shift));
            let shifted = &shifted[3 * SIZE * SIZE..];
            for patch in 0..GRID {
                let center = patch * 16 + 8;
                assert_eq!(shifted[center * SIZE + center], patch as f32);
                assert_eq!(shifted[SIZE * SIZE + center * SIZE + center], patch as f32);
            }
        }
    }
}

#[test]
fn zoom_is_bilinear_about_the_centre() {
    for side in LEVELS {
        let identity = zoom_coefficients(side, 1.0);
        let zoomed = zoom_coefficients(side, 1.01);
        for row in 0..side {
            assert_eq!(identity[row * side + row], 1.0);
            let sum: f32 = zoomed[row * side..(row + 1) * side].iter().sum();
            assert!((sum - 1.0).abs() < 1e-6);
        }
    }
    // A ramp through the centre is linear, so bilinear zoom divides it exactly by the scale.
    let side = 16;
    let ramp: Vec<f32> = (0..side).map(|index| index as f32 + 0.5 - side as f32 / 2.0).collect();
    let coefficients = zoom_coefficients(side, 1.25);
    for (row, expected) in ramp.iter().enumerate() {
        let value: f32 = (0..side).map(|column| coefficients[row * side + column] * ramp[column]).sum();
        assert!((value - expected / 1.25).abs() < 1e-5, "{value} vs {}", expected / 1.25);
    }
}

#[test]
fn zoom_keeps_a_constant_canvas_and_rejects_rates_outside_the_range() {
    let device = Device::flex().autodiff();
    for rate in [-0.01, MAX_ZOOM_PER_UPDATE + 0.001, f32::NAN] {
        assert!(Zoom::new(rate, &device).is_err());
    }
    let mut canvas = Canvas::from_seed(0, vec![true; GRID * GRID], &device);
    for level in &mut canvas.pyramid.levels {
        *level = (level.clone().inner().zeros_like() + 0.3).autodiff().require_grad();
    }
    let before = values(canvas.compose());
    canvas.zoom(&Zoom::new(0.02, &device).unwrap());
    let after = values(canvas.compose());
    let error = before.iter().zip(&after).map(|(a, b)| (a - b).abs()).fold(0.0, f32::max);
    assert!(error < 1e-6, "zoom changed a constant image by {error}");
}

/// The cell (row-major) holding the centre of parameter `index` of a level of `side`.
fn centre_cell(index: usize, side: usize) -> usize {
    let footprint = SIZE / side;
    let cell = |position: usize| (position * footprint + footprint / 2) / (SIZE / GRID);
    cell((index / side) % side) * GRID + cell(index % side)
}

/// A 4 × 4 block of painted cells at rows and columns 4..8, with cell (5, 6) protected.
fn painted_block() -> (Vec<bool>, Vec<bool>) {
    let painted: Vec<bool> = (0..GRID * GRID).map(|cell| (4..8).contains(&(cell / GRID)) && (4..8).contains(&(cell % GRID))).collect();
    let mut editable = vec![true; GRID * GRID];
    editable[5 * GRID + 6] = false;
    (painted, editable)
}

#[test]
fn reseed_draws_painted_editable_parameters_from_the_seed_and_keeps_the_rest() {
    let device = Device::flex().autodiff();
    let (painted, editable) = painted_block();
    let mut canvas = Canvas::from_seed(3, editable.clone(), &device);
    let before: Vec<Vec<f32>> = canvas.pyramid.levels.iter().map(|level| values(level.clone())).collect();
    let image_before = values(canvas.compose());
    canvas.reseed(&painted, 7);
    let fresh = Pyramid::new(7, &device);
    for (((&side, before), after), fresh) in LEVELS.iter().zip(before).zip(&canvas.pyramid.levels).zip(fresh.levels) {
        let (after, fresh) = (values(after.clone()), values(fresh));
        for index in 0..3 * side * side {
            let cell = centre_cell(index, side);
            let expected = if painted[cell] && editable[cell] { fresh[index] } else { before[index] };
            assert_eq!(after[index], expected, "level {side}, parameter {index}");
        }
    }
    // The protected cell still shows the base exactly; a far corner is untouched.
    let image_after = values(canvas.compose());
    let pixel = |row: usize, column: usize| row * SIZE + column;
    assert_eq!(image_after[pixel(5 * 16 + 3, 6 * 16 + 9)], image_before[pixel(5 * 16 + 3, 6 * 16 + 9)]);
    assert_eq!(image_after[pixel(250, 3)], image_before[pixel(250, 3)]);
    assert_ne!(image_after[pixel(4 * 16 + 5, 4 * 16 + 5)], image_before[pixel(4 * 16 + 5, 4 * 16 + 5)]);
}

#[test]
fn reseed_changes_the_image_at_most_24_pixels_past_the_painted_cells() {
    // Bicubic upsampling of the 16 × 16 level reaches 32 pixels from a parameter's centre,
    // and that centre lies 8 pixels inside its cell, so nothing beyond 24 pixels can move.
    let device = Device::flex().autodiff();
    let (painted, _) = painted_block();
    let mut widest = [0usize; 3];
    for seed in [3, 11, 19] {
        let mut canvas = Canvas::from_seed(seed, vec![true; GRID * GRID], &device);
        let before = values(canvas.compose());
        canvas.reseed(&painted, seed + 1);
        let after = values(canvas.compose());
        for row in 0..SIZE {
            for column in 0..SIZE {
                // Pixels past the block's edge, in the Chebyshev distance from rows and columns 64..128.
                let outside = |position: usize| if position < 64 { 64 - position } else { (position + 1).saturating_sub(128) };
                let distance = outside(row).max(outside(column));
                let change = (0..3).map(|channel| (after[(channel * SIZE + row) * SIZE + column] - before[(channel * SIZE + row) * SIZE + column]).abs()).fold(0.0, f32::max);
                for (threshold, width) in [0.0, 1.0 / 255.0, 4.0 / 255.0].into_iter().zip(&mut widest) {
                    if change > threshold {
                        *width = (*width).max(distance);
                    }
                }
            }
        }
    }
    println!("re-seed bleed past the painted cells (pixels): any change {}, over 1/255 {}, over 4/255 {}", widest[0], widest[1], widest[2]);
    assert!(widest[0] <= 24, "a change {} pixels past the painted cells", widest[0]);
}

#[test]
fn a_restored_picture_is_the_first_frame_exactly() {
    // Every byte value in every channel, including 0 and 255, and a protected cell.
    let device = Device::flex().autodiff();
    let pixels = SIZE * SIZE;
    let bytes: Vec<u8> = (0..3 * pixels).map(|index| ((index * 7 + index / pixels * 85) % 256) as u8).collect();
    let picture: Vec<f32> = bytes.iter().map(|&byte| byte as f32 / 255.0).collect();
    let mut editable = vec![true; GRID * GRID];
    editable[GRID + 3] = false;
    let canvas = Canvas::from_picture(Tensor::from_data(TensorData::new(picture, [1, 3, SIZE, SIZE]), &device), editable);
    let shown: Vec<u8> = values(canvas.compose()).iter().map(|&value| (value.clamp(0.0, 1.0) * 255.0).round() as u8).collect();
    let differing = shown.iter().zip(&bytes).filter(|(a, b)| a != b).count();
    assert_eq!(differing, 0, "{differing} of {} values differ", bytes.len());
}

#[test]
fn the_gaussian_blur_rows_sum_to_one_and_fold_at_the_borders() {
    use dinodreamer_engine::image::gaussian_coefficients;
    let side = 16;
    let coefficients = gaussian_coefficients(side, 1.0, 3);
    for row in coefficients.chunks_exact(side) {
        assert!((row.iter().sum::<f32>() - 1.0).abs() < 1e-5);
    }
    // An interior row is symmetric about its output; the centre weight of σ = 1 with 7 taps is 0.399 / 1.0.
    let row = &coefficients[8 * side..9 * side];
    assert!((row[7] - row[9]).abs() < 1e-6 && (row[5] - row[11]).abs() < 1e-6 && row[8] > row[7]);
    let expected_centre = 1.0 / (1.0 + 2.0 * ((-0.5f32).exp() + (-2.0f32).exp() + (-4.5f32).exp()));
    assert!((row[8] - expected_centre).abs() < 1e-5, "{}", row[8]);
    // Row 0 folds its three taps past the border back onto positions 1, 2 and 3.
    let first = &coefficients[0..side];
    assert_eq!(first[0], row[8]);
    assert!((first[1] - 2.0 * row[7]).abs() < 1e-6 && (first[3] - 2.0 * row[5]).abs() < 1e-6);
    // The blur of a constant image is the constant.
    let device = Device::flex().autodiff();
    let blur = Resample::new(&coefficients, side, &device);
    let ones = Tensor::<4>::ones([1, 3, side, side], &device);
    let blurred = blur.apply(ones).into_data().try_to_vec::<f32>().unwrap();
    assert!(blurred.iter().all(|&value| (value - 1.0).abs() < 1e-5));
}
