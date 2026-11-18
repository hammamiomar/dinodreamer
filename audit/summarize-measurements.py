"""Summarize the JSON traces without starting a browser. Pass the evidence directory."""
import csv
import gzip
import json
import sys
from pathlib import Path
from statistics import median, quantiles

root = Path(sys.argv[1])
records = []
for path in sorted((root / "traces").glob("*.json.gz")):
    if path.name.endswith(".chrome.json.gz"):
        continue
    with gzip.open(path) as stream:
        data = json.load(stream)
    observation = data["observed"]
    milestones = observation["milestones"]
    requests = data["requests"]
    clicks = observation["clicks"]
    destination = milestones.get("destination")
    click = next((item for item in reversed(clicks) if item["path"] == "/automata"), {})
    frames = observation["frames"]
    gaps = [b - a for a, b in zip(frames, frames[1:])]
    waits = [duration for _, duration in observation["queueWaits"]]
    tasks = [duration for _, duration in observation["tasks"]]
    image_requests = [item for item in requests if item["type"] == "Image"]
    profile = data.get("deviceProfile") or {}
    samples = [sum(duration for _, duration in sample["durations"]) for sample in profile.get("samples", [])]
    records.append({
        "trace": path.name, "environment": data["environment"], "mode": data["mode"],
        "case": data["name"], "variant": data["variant"], "path": data["path"],
        "end_path": data["url"].split(data["base"])[-1],
        "first_paint_ms": dict(data["paint"]).get("first-paint"),
        "first_contentful_paint_ms": dict(data["paint"]).get("first-contentful-paint"),
        "control_ready_ms": milestones.get("ready"), "first_live_face_ms": milestones.get("firstFace"),
        "input_dispatch_ms": click["at"] - click["event"] if click else None,
        "click_to_destination_ms": destination - click["at"] if click and destination else None,
        "observation_end_ms": data["clock"], "long_tasks": len(tasks),
        "longest_task_ms": max(tasks, default=0), "requests": len(requests),
        "completed_responses": sum("bytes" in item for item in requests),
        "completed_encoded_bytes": sum(item.get("bytes", 0) for item in requests),
        "images": len(image_requests), "images_started_after_destination": sum(
            item["wall"] * 1000 > data["origin"] + destination for item in image_requests
        ) if destination else None,
        "webgpu_peak_buffer_bytes": observation["peakBuffers"], "webgpu_end_buffer_bytes": observation["buffers"],
        "webgpu_submissions": observation["submits"], "webgpu_pipeline_requests": observation["pipelines"],
        "queue_wait_p50_ms": median(waits) if waits else None,
        "queue_wait_p95_ms": quantiles(waits, n=100, method="inclusive")[94] if len(waits) > 1 else None,
        "frame_gap_p95_ms": quantiles(gaps, n=100, method="inclusive")[94] if len(gaps) > 1 else None,
        "sampled_gpu_commands": len(samples), "gpu_pass_sum_p50_ms": median(samples) if samples else None,
        "page_or_console_errors": len(data["events"]), "failure": data.get("failure", ""),
    })
with (root / "measurements.csv").open("w", newline="") as output:
    writer = csv.DictWriter(output, records[0].keys())
    writer.writeheader()
    writer.writerows(records)
