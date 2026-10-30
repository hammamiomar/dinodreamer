//! Only exported by the harness build. The public bundle has no qualification API.

use super::{BrowserEngine, error, evaluation_object};
use crate::{
    encoder::{HEAD_WIDTH, HEADS, TOKENS, WIDTH},
    kernels::{frozen_linear, projected_attention, scaled_attention},
    objective::{ObjectiveSpec, ProbeSpec},
    profiling::StepProfile,
    qualification::Inputs,
};
use burn::tensor::{Distribution, Tensor, wgpu::wgpu};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

impl BrowserEngine {
    pub(crate) fn has_timestamps(&self) -> bool {
        self.setup
            .device
            .features()
            .contains(wgpu::Features::TIMESTAMP_QUERY)
    }

    fn pool_memory(&self) -> Value {
        self.device
            .memory_pool_usage()
            .map(|memory| {
                json!({
                    "used_bytes": memory.bytes_in_use,
                    "reserved_bytes": memory.bytes_reserved,
                    "allocations": memory.number_allocs,
                })
            })
            .unwrap_or(Value::Null)
    }

    pub(crate) async fn wait_completed(&self) -> Result<(), JsValue> {
        completed(&self.device, &self.setup.queue).await
    }

    async fn time_product(
        &self,
        repeats: u32,
        name: &str,
        forward_flops: f64,
        forward_backward_flops: f64,
        forward: impl FnMut(),
        forward_backward: impl FnMut(),
    ) -> Result<Value, JsValue> {
        let forward_ms = self.time_per_call(repeats, forward).await?;
        let forward_backward_ms = self.time_per_call(repeats, forward_backward).await?;
        Ok(json!({
            "name": name,
            "forward_ms": forward_ms,
            "forward_backward_ms": forward_backward_ms,
            "forward_tflops": forward_flops / forward_ms / 1e9,
            "forward_backward_tflops": forward_backward_flops / forward_backward_ms / 1e9,
        }))
    }

    /// Milliseconds per call: one warm call, then `repeats` calls between two queue completions.
    async fn time_per_call(&self, repeats: u32, mut piece: impl FnMut()) -> Result<f64, JsValue> {
        piece();
        self.wait_completed().await?;
        let start = now_ms()?;
        for _ in 0..repeats {
            piece();
        }
        self.wait_completed().await?;
        Ok((now_ms()? - start) / repeats as f64)
    }
}

/// Flush Burn's pending commands, then wait on THAT device's queue. This does not read a
/// tensor and does not use WASM's blocking sync path.
async fn completed(device: &burn::tensor::Device, queue: &wgpu::Queue) -> Result<(), JsValue> {
    device.flush().map_err(error)?;
    let completed = js_sys::Promise::new(&mut |resolve, _reject| {
        queue.on_submitted_work_done(move || {
            let _ = resolve.call0(&JsValue::NULL);
        });
    });
    JsFuture::from(completed).await?;
    Ok(())
}

/// `performance.now()` of the worker: finer than `Date.now()`, which has whole milliseconds.
fn now_ms() -> Result<f64, JsValue> {
    let performance = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("performance"))?;
    let now = js_sys::Function::from(js_sys::Reflect::get(&performance, &JsValue::from_str("now"))?);
    now.call0(&performance)?.as_f64().ok_or_else(|| error("performance.now() returned no number"))
}

#[wasm_bindgen]
impl BrowserEngine {
    pub fn harness_capabilities_json(&self) -> String {
        let adapter = self.setup.adapter.get_info();
        let limits = self.setup.device.limits();
        json!({
            "adapter": {
                "name": adapter.name,
                "vendor": adapter.vendor,
                "device": adapter.device,
                "device_type": format!("{:?}", adapter.device_type),
                "driver": adapter.driver,
                "driver_info": adapter.driver_info,
                "backend": format!("{:?}", adapter.backend),
                "is_fallback": adapter.device_type == wgpu::DeviceType::Cpu,
            },
            "features": format!("{:?}", self.setup.device.features()),
            "timestamps": self.has_timestamps(),
            "shader_f16": self.setup.device.features().contains(wgpu::Features::SHADER_F16),
            "limits": {
                "max_buffer_size": limits.max_buffer_size,
                "max_storage_buffer_binding_size": limits.max_storage_buffer_binding_size,
                "max_storage_buffers_per_shader_stage": limits.max_storage_buffers_per_shader_stage,
                "max_compute_workgroup_storage_size": limits.max_compute_workgroup_storage_size,
                "max_compute_invocations_per_workgroup": limits.max_compute_invocations_per_workgroup,
                "max_compute_workgroup_size_x": limits.max_compute_workgroup_size_x,
                "max_compute_workgroup_size_y": limits.max_compute_workgroup_size_y,
                "max_compute_workgroups_per_dimension": limits.max_compute_workgroups_per_dimension,
            },
            "precision": {
                "weights": "fp32", "activations": "fp32", "reductions": "fp32",
                "image_parameters": "fp32", "optimizer_state": "fp32",
            },
            "features_build": {"fusion": false, "autotune": false},
        }).to_string()
    }

    pub fn harness_memory_json(&self) -> String {
        self.pool_memory().to_string()
    }

    pub async fn harness_complete(&self) -> Result<(), JsValue> {
        self.wait_completed().await
    }

    /// One update with no loss or pixel readback; resolves when the GPU queue is done.
    pub async fn harness_compute_step(&mut self) -> Result<String, JsValue> {
        let started = js_sys::Date::now();
        let pending = self
            .engine
            .as_mut()
            .ok_or_else(|| error("Load the model first"))?
            .update(&mut StepProfile::default())
            .await
            .map_err(error)?
            .ok_or_else(|| error("Nothing to optimize"))?;
        self.device.flush().map_err(error)?;
        let submission_ms = js_sys::Date::now() - started;
        self.wait_completed().await?;
        Ok(json!({"step": pending.step(), "submission_ms": submission_ms}).to_string())
    }

    /// Time per call of one encoder block's matrix products at the update's shapes (two views
    /// of 261 tokens): the four linear layers and attention, each as the forward and as the
    /// forward with the input gradients. Each runs `repeats` times between two queue
    /// completions, so the time includes launch overhead. Natively: `examples/kernel_benchmarks.rs`.
    pub async fn harness_product_timings(&self, repeats: u32) -> Result<String, JsValue> {
        let rows = 2 * TOKENS;
        let mut timings = Vec::new();
        for (name, input, output) in [
            ("qkv", WIDTH, 3 * WIDTH),
            ("proj", WIDTH, WIDTH),
            ("mlp in", WIDTH, 4 * WIDTH),
            ("mlp out", 4 * WIDTH, WIDTH),
        ] {
            let weight_OI = Tensor::<2>::random([output, input], Distribution::Default, &self.device).inner().autodiff();
            let tokens_BTI = Tensor::<3>::random([2, TOKENS, input], Distribution::Default, &self.device);
            let tracked_BTI = tokens_BTI.clone().require_grad();
            let forward = || {
                let _ = frozen_linear(tokens_BTI.clone(), weight_OI.clone());
            };
            let forward_backward = || {
                let _ = frozen_linear(tracked_BTI.clone(), weight_OI.clone()).sum().backward();
            };
            let flops = 2.0 * (rows * input * output) as f64;
            timings.push(self.time_product(repeats, name, flops, 2.0 * flops, forward, forward_backward).await?);
        }
        // Q K^T and P V forward; the backward adds four products of the same size.
        let heads = || Tensor::<4>::random([2, HEADS, TOKENS, HEAD_WIDTH], Distribution::Default, &self.device);
        let (query_BHTE, key_BHTE, value_BHTE) = (heads(), heads(), heads());
        let tracked = [&query_BHTE, &key_BHTE, &value_BHTE].map(|tensor| tensor.clone().require_grad());
        let forward = || {
            let _ = scaled_attention(query_BHTE.clone(), key_BHTE.clone(), value_BHTE.clone());
        };
        let forward_backward = || {
            let _ = scaled_attention(tracked[0].clone(), tracked[1].clone(), tracked[2].clone()).sum().backward();
        };
        let flops = 4.0 * (2 * HEADS * TOKENS * TOKENS * HEAD_WIDTH) as f64;
        timings.push(self.time_product(repeats, "attention", flops, 3.0 * flops, forward, forward_backward).await?);
        // The same from the qkv projection: the bias, head split and RoPE kernel first.
        if let Some(engine) = &self.engine {
            let (sin_PE, cos_PE) = engine.encoder.rope.tables_PE();
            let columns = 3 * WIDTH;
            let projected_BTO = Tensor::<3>::random([2, TOKENS, columns], Distribution::Default, &self.device);
            let bias_O = Tensor::<1>::random([columns], Distribution::Default, &self.device);
            let tracked_BTO = projected_BTO.clone().require_grad();
            let attend = |projected_BTO: Tensor<3>| {
                projected_attention(projected_BTO, bias_O.clone(), sin_PE.clone(), cos_PE.clone())
            };
            let forward = || {
                let _ = attend(projected_BTO.clone());
            };
            let forward_backward = || {
                let _ = attend(tracked_BTO.clone()).sum().backward();
            };
            timings.push(self.time_product(repeats, "attention from qkv", flops, 3.0 * flops, forward, forward_backward).await?);
        }
        Ok(Value::Array(timings).to_string())
    }

    /// One frame-mode update split in time: building and submitting the update; with
    /// `wait_first`, waiting for the GPU queue before the readback; the readback of image,
    /// terms and codes; the conversion to the JS evaluation. Without `wait_first` the readback
    /// follows the submission at once, as in `step`.
    pub async fn harness_frame_breakdown(&mut self, wait_first: bool) -> Result<String, JsValue> {
        let BrowserEngine { device, engine, setup, .. } = self;
        let engine = engine.as_mut().ok_or_else(|| error("Load the model first"))?;
        let started = now_ms()?;
        let pending = engine
            .update(&mut StepProfile::default())
            .await
            .map_err(error)?
            .ok_or_else(|| error("Nothing to optimize"))?;
        let submitted = now_ms()?;
        if wait_first {
            completed(device, &setup.queue).await?;
        }
        let idle = now_ms()?;
        let evaluation = engine.read(pending).await.map_err(error)?;
        let read = now_ms()?;
        let _ = evaluation_object(evaluation, device)?;
        let converted = now_ms()?;
        Ok(json!({
            "submission_ms": submitted - started,
            "gpu_wait_ms": idle - submitted,
            "readback_ms": read - idle,
            "conversion_ms": converted - read,
            "total_ms": converted - started,
        })
        .to_string())
    }

    pub async fn harness_profile_step(&mut self) -> Result<String, JsValue> {
        if !self.has_timestamps() {
            return Err(error(
                "GPU timestamps unavailable; use completion wall time",
            ));
        }
        let mut profile = StepProfile::gpu(&self.device);
        let pending = self
            .engine
            .as_mut()
            .ok_or_else(|| error("Load the model first"))?
            .update(&mut profile)
            .await
            .map_err(error)?
            .ok_or_else(|| error("Nothing to optimize"))?;
        self.wait_completed().await?;
        let stages = profile.resolve().await;
        Ok(json!({"step": pending.step(), "stages": stages}).to_string())
    }

    /// `specs` is evidence-specs.json; `editable` one byte per cell; previews pair with image ids.
    pub async fn harness_qualify(
        &mut self,
        reference: &[u8],
        specs: &str,
        editable: &[u8],
        image_ids: Vec<f64>,
        previews: js_sys::Array,
        progress: js_sys::Function,
    ) -> Result<String, JsValue> {
        #[derive(serde::Deserialize)]
        struct Specs {
            objective: ObjectiveSpec,
            probes: Vec<ProbeSpec>,
            /// The recipe's optimizer settings; the engine's defaults when the fixture has none.
            #[serde(default)]
            optimizer: Option<crate::state::OptimizerSpec>,
        }
        let specs: Specs = serde_json::from_str(specs).map_err(error)?;
        let previews: Vec<Vec<u8>> = previews
            .iter()
            .map(|bytes| js_sys::Uint8Array::new(&bytes).to_vec())
            .collect();
        let timestamps = self.has_timestamps();
        let report_progress = |check: &crate::qualification::Comparison| {
            let _ = progress.call1(
                &JsValue::NULL,
                &JsValue::from_str(&serde_json::to_string(check).expect("Finite numerical metrics")),
            );
        };
        let engine = self
            .engine
            .as_mut()
            .ok_or_else(|| error("Load the model first"))?;
        let inputs = Inputs {
            reference,
            objective: specs.objective,
            probes: specs.probes,
            optimizer: specs.optimizer,
            editable: editable.iter().map(|&cell| cell != 0).collect(),
            previews: image_ids
                .iter()
                .map(|&id| id as u64)
                .zip(previews.iter().map(Vec::as_slice))
                .collect(),
        };
        let mut report = engine.qualify(inputs, report_progress).await.map_err(error)?;
        if timestamps {
            let checks = engine.check_profile_equivalence().await.map_err(error)?;
            for check in &checks {
                report_progress(check);
            }
            report.checks.extend(checks);
        }
        report.passed = report.checks.iter().all(|check| check.passed);
        Ok(json!({
            "passed": report.passed,
            "checks": report.checks,
            "profile_equivalence": if timestamps { "checked" } else { "unavailable: no timestamp-query" },
        }).to_string())
    }
}
