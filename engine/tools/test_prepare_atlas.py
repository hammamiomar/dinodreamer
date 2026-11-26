"""Numerical and file-boundary checks for compact Atlas records."""

import json
from pathlib import Path
import tempfile
import unittest

import numpy as np

from prepare_atlas import (
    HEADER,
    PICTURE,
    POINT_DTYPE,
    allocate_examples,
    choose_pictures,
    flat_points,
    inspect_record,
    pack_record,
    prepare_block,
    principal_axes,
    strength_bands,
)


def record_points(data: bytes) -> tuple[np.ndarray, np.ndarray, int]:
    """A record's stored points, its plane axes [R, 2] and the flat view's point count."""
    header = HEADER.unpack_from(data)
    points_N = np.frombuffer(data, dtype=POINT_DTYPE, count=header[3], offset=HEADER.size)
    axes_R2 = np.asarray(header[20:26], dtype=np.float64).reshape(2, 3).T
    return points_N, axes_R2, header[26]


def source():
    rows = [
        {
            "code": [float(value), 0.1, 0.0],
            "norm": float(np.hypot(value, 0.1)),
            "image_id": 2**53 - 1 - value,
            "slot": 5 + value,
            "public_preview": True,
        }
        for value in range(1, 17)
    ]
    fixture = {
        "format": 2,
        "block": 12182,
        "source": {"release": "pass-003"},
        "rows": rows,
    }
    summary = {
        "block": 12182,
        "release": "pass-003",
        "sample": {"rows": 16},
        "gate_median": 4.0,
        "main_lobe": {"direction": [1.0, 0.0, 0.0]},
        "radius": {"p95": 15.0},
        "patch_rows": 1024,
        "public_fraction": 0.75,
        "near_gate_fraction": 0.25,
        "pole": None,
    }
    return fixture, summary


class AtlasPreparationTests(unittest.TestCase):
    def test_counts_keep_empty_bands_empty_and_rare_bands_visible(self):
        np.testing.assert_array_equal(
            allocate_examples(np.array([3406, 480, 141, 69]), 12), [9, 1, 1, 1]
        )
        np.testing.assert_array_equal(
            allocate_examples(np.array([4094, 0, 1, 1]), 12), [10, 0, 1, 1]
        )
        np.testing.assert_array_equal(
            allocate_examples(np.array([1, 1, 0, 0]), 12), [1, 1, 0, 0]
        )

    def test_four_pictures_per_band_and_fewer_only_for_a_smaller_band(self):
        fixture, summary = source()
        rows = fixture["rows"]
        norms_N = np.array([row["norm"] for row in rows])
        # Ring 4, maximum 16.0003: cuts near 7, 10 and 13; 6, 3, 3 and 4 patches.
        bands_N, counts_S = strength_bands(norms_N, 4.0)
        np.testing.assert_array_equal(counts_S, [6, 3, 3, 4])
        pictures = choose_pictures(rows, norms_N, bands_N, counts_S)
        self.assertEqual([band for _, _, band in pictures], [0] * 4 + [1] * 3 + [2] * 3 + [3] * 4)
        self.assertEqual(len({image_id for image_id, _, _ in pictures}), 14)
        # Barely's four sit at quantiles 1/8, 3/8, 5/8 and 7/8 of its six patches: ranks 0, 2, 3 and 5.
        slots = [slot for _, slot, band in pictures if band == 0]
        self.assertEqual(slots, [6, 8, 9, 11])

    def test_rare_bands_choose_distinct_pictures_first(self):
        fixture, summary = source()
        rows = fixture["rows"]
        # Two Strongest patches share their pictures with Barely's first and third.
        # Choosing Barely first would take them and push Strongest off its patches.
        rows[0]["image_id"] = rows[12]["image_id"]
        rows[2]["image_id"] = rows[13]["image_id"]
        norms_N = np.array([row["norm"] for row in rows])
        bands_N, counts_S = strength_bands(norms_N, 4.0)
        pictures = choose_pictures(rows, norms_N, bands_N, counts_S)
        strongest = [slot for _, slot, band in pictures if band == 3]
        self.assertEqual(strongest, [18, 19, 20, 21])
        barely = [image_id for image_id, _, band in pictures if band == 0]
        self.assertFalse(set(barely) & {rows[index]["image_id"] for index in range(12, 16)})

    def test_band_boundaries_and_inside_ring_winners(self):
        bands, counts = strength_bands(np.array([2, 4, 7, 10, 13, 16], dtype=float), 4)
        np.testing.assert_array_equal(bands, [0, 0, 1, 2, 3, 3])
        np.testing.assert_array_equal(counts, [2, 1, 1, 2])
        np.testing.assert_array_equal(
            strength_bands(np.array([1, 2]), 3)[1], [2, 0, 0, 0]
        )

    def test_binary_keeps_large_ids_exact_and_sampling_is_repeatable(self):
        fixture, summary = source()
        data = pack_record(fixture, summary)
        self.assertEqual(data, pack_record(fixture, summary))
        self.assertEqual(HEADER.size, 88)
        self.assertEqual(POINT_DTYPE.itemsize, 7)
        self.assertEqual(data[:4], b"ATC3")
        header = HEADER.unpack_from(data)
        self.assertEqual(sum(header[8:12]), 16)
        offset = HEADER.size + header[3] * POINT_DTYPE.itemsize
        addresses = [
            PICTURE.unpack_from(data, offset + index * PICTURE.size)
            for index in range(header[4])
        ]
        original = {(row["image_id"], row["slot"]) for row in fixture["rows"]}
        self.assertTrue(
            all((image_id, slot) in original for image_id, slot, _ in addresses)
        )
        self.assertTrue(all(image_id > 2**32 for image_id, _, _ in addresses))
        self.assertEqual(inspect_record(data)["total"], 16)

    def test_resume_uses_completed_record_without_reading_large_source(self):
        fixture, summary = source()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "output"
            (output / "blocks").mkdir(parents=True)
            (output / "blocks/12182.bin").write_bytes(pack_record(fixture, summary))
            record = prepare_block(
                (str(root / "source-does-not-exist"), str(output), 12182)
            )
            self.assertTrue(record["resumed"])
            self.assertEqual(record["source_bytes"], 0)

    def test_full_sample_thinning_is_seeded_and_keeps_rare_bands(self):
        fixture, summary = source()
        generator = np.random.default_rng(17)
        codes_NR = generator.normal(size=(4096, 3)) + np.array([8.0, 0.0, 0.0])
        codes_NR[-1] = [80.0, 0.0, 0.0]
        norms_N = np.linalg.norm(codes_NR, axis=1)
        fixture["rows"] = [
            {
                "code": code.tolist(),
                "norm": float(norm),
                "image_id": 2**53 - 1 - index,
                "slot": 5 + index % 256,
                "public_preview": True,
            }
            for index, (code, norm) in enumerate(zip(codes_NR, norms_N))
        ]
        summary["sample"]["rows"] = 4096
        data = pack_record(fixture, summary)
        self.assertEqual(data, pack_record(fixture, summary))
        header = HEADER.unpack_from(data)
        self.assertEqual(header[3], 1024)
        self.assertEqual(header[26], 512)
        self.assertEqual(header[11], 1)
        self.assertEqual(inspect_record(data)["counts"], [4095, 0, 0, 1])

    def test_points_are_native_codes_and_the_flat_view_is_their_plane(self):
        fixture, summary = source()
        generator = np.random.default_rng(23)
        codes_NR = generator.normal(size=(4096, 3)) * [6.0, 2.0, 0.5] + [9.0, 0.0, 0.0]
        norms_N = np.linalg.norm(codes_NR, axis=1)
        fixture["rows"] = [
            {
                "code": code.tolist(),
                "norm": float(norm),
                "image_id": 2**53 - 1 - index,
                "slot": 5 + index % 256,
                "public_preview": True,
            }
            for index, (code, norm) in enumerate(zip(codes_NR, norms_N))
        ]
        summary["sample"]["rows"] = 4096
        points_N, axes_R2, flat_count = record_points(pack_record(fixture, summary))
        self.assertEqual((len(points_N), flat_count), (1024, 512))
        # Every stored point is one row of the sample, to float16, and no row is stored twice.
        stored_NR = points_N["code"].astype(np.float64)
        nearest_N = np.abs(stored_NR[:, None, :] - codes_NR[None, :, :]).sum(axis=2).argmin(axis=1)
        self.assertEqual(len(set(nearest_N.tolist())), 1024)
        np.testing.assert_allclose(stored_NR, codes_NR[nearest_N], rtol=6e-4, atol=1e-6)
        # The axes are those of the whole sample, and the flat view is the leading points in them.
        np.testing.assert_allclose(axes_R2, principal_axes(codes_NR, np.array([1.0, 0.0, 0.0])), atol=1e-6)
        np.testing.assert_allclose(
            flat_points(points_N[:flat_count], axes_R2),
            codes_NR[nearest_N[:flat_count]] @ axes_R2,
            atol=0.03,
        )
        # The strongest patch of the sample is in the flat view.
        self.assertIn(int(norms_N.argmax()), nearest_N[:flat_count].tolist())

    def test_a_small_sample_is_stored_whole_in_the_flat_view(self):
        fixture, summary = source()
        points_N, _, flat_count = record_points(pack_record(fixture, summary))
        self.assertEqual((len(points_N), flat_count), (16, 16))


if __name__ == "__main__":
    unittest.main()
