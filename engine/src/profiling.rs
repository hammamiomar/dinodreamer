//! Optional timing windows around the real update. Resolve only after submission.

use burn::tensor::{Device, ProfileDuration};
use serde::Serialize;

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = performance, js_name = now)]
    fn performance_now() -> f64;
}

#[derive(Default)]
pub struct StepProfile {
    device: Option<Device>,
    windows: Vec<(&'static str, ProfileDuration, f64)>,
}

#[derive(Debug, Serialize)]
pub struct StageTime {
    pub stage: &'static str,
    pub method: String,
    // A missing timestamp is not a zero-cost operation.
    pub milliseconds: Option<f64>,
    // Host work and command submission. This can overlap GPU work and is not additive.
    #[serde(rename = "hostMilliseconds")]
    pub host_milliseconds: f64,
}

impl StepProfile {
    /// The caller must check timestamp-query support before enabling this on WASM.
    pub fn gpu(device: &Device) -> Self {
        Self {
            device: Some(device.clone()),
            windows: Vec::new(),
        }
    }

    pub fn record<O: Send + 'static>(
        &mut self,
        stage: &'static str,
        operation: impl FnOnce() -> O + Send,
    ) -> O {
        let Some(device) = &self.device else {
            return operation();
        };
        #[cfg(target_arch = "wasm32")]
        let started = performance_now();
        #[cfg(not(target_arch = "wasm32"))]
        let started = std::time::Instant::now();
        let (result, duration) = device.profile(operation).expect("GPU profiling failed");
        #[cfg(target_arch = "wasm32")]
        let host_milliseconds = performance_now() - started;
        #[cfg(not(target_arch = "wasm32"))]
        let host_milliseconds = started.elapsed().as_secs_f64() * 1000.0;
        self.windows.push((stage, duration, host_milliseconds));
        result
    }

    pub async fn resolve(self) -> Vec<StageTime> {
        let mut stages = Vec::with_capacity(self.windows.len());
        for (stage, duration, host_milliseconds) in self.windows {
            let method = duration.timing_method().to_string();
            let milliseconds = duration
                .resolve()
                .await
                .map(|ticks| ticks.duration().as_secs_f64() * 1000.0);
            stages.push(StageTime {
                stage,
                method,
                milliseconds,
                host_milliseconds,
            });
        }
        stages
    }
}

// Harness builds time the figure update in two separate passes, each with its own windows, so no
// timestamp window nests in another: the broad pass (`broad`: rollout, reader forward, backward,
// recompute, Adam) and the kernel-family pass (`detail`: one window per instrumented kernel group).
// The public build has neither slot and runs the operations directly.
#[cfg(feature = "harness")]
type ProfileSlot = std::thread::LocalKey<std::cell::RefCell<Option<StepProfile>>>;

#[cfg(feature = "harness")]
thread_local! {
    static BROAD_PROFILE: std::cell::RefCell<Option<StepProfile>> = const { std::cell::RefCell::new(None) };
    static KERNEL_PROFILE: std::cell::RefCell<Option<StepProfile>> = const { std::cell::RefCell::new(None) };
}

/// The broad pass: the update's stages, as `grow/figure/rule.rs` names them.
#[cfg(feature = "harness")]
pub struct BroadProfile;

/// The kernel-family pass: the windows the kernels name.
#[cfg(feature = "harness")]
pub struct KernelProfile;

#[cfg(feature = "harness")]
fn start_pass(slot: &'static ProfileSlot, device: &Device) {
    slot.with(|cell| {
        assert!(cell.borrow().is_none(), "Profile passes must not overlap");
        *cell.borrow_mut() = Some(StepProfile::gpu(device));
    });
}

#[cfg(feature = "harness")]
async fn resolve_pass(slot: &'static ProfileSlot) -> Vec<StageTime> {
    let profile = slot.with(|cell| cell.borrow_mut().take()).unwrap();
    profile.resolve().await
}

#[cfg(feature = "harness")]
impl BroadProfile {
    pub fn start(device: &Device) -> Self {
        start_pass(&BROAD_PROFILE, device);
        Self
    }

    pub async fn resolve(self) -> Vec<StageTime> {
        resolve_pass(&BROAD_PROFILE).await
    }
}

#[cfg(feature = "harness")]
impl Drop for BroadProfile {
    fn drop(&mut self) {
        BROAD_PROFILE.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

#[cfg(feature = "harness")]
impl KernelProfile {
    pub fn start(device: &Device) -> Self {
        start_pass(&KERNEL_PROFILE, device);
        Self
    }

    pub async fn resolve(self) -> Vec<StageTime> {
        resolve_pass(&KERNEL_PROFILE).await
    }
}

#[cfg(feature = "harness")]
impl Drop for KernelProfile {
    fn drop(&mut self) {
        KERNEL_PROFILE.with(|slot| {
            slot.borrow_mut().take();
        });
    }
}

/// Record `operation` as one window of the pass in `slot`, if that pass is active. The profile
/// leaves the slot while the operation runs, so a window inside a window is not recorded.
#[cfg(feature = "harness")]
fn window<O: Send + 'static>(
    slot: &'static ProfileSlot,
    stage: &'static str,
    operation: impl FnOnce() -> O + Send,
) -> O {
    let profile = slot.with(|cell| cell.borrow_mut().take());
    match profile {
        Some(mut profile) => {
            let output = profile.record(stage, operation);
            slot.with(|cell| *cell.borrow_mut() = Some(profile));
            output
        }
        None => operation(),
    }
}

/// One stage of the figure update in the broad pass.
#[cfg(feature = "gpu")]
#[inline]
pub(crate) fn broad<O: Send + 'static>(
    stage: &'static str,
    operation: impl FnOnce() -> O + Send,
) -> O {
    #[cfg(feature = "harness")]
    return window(&BROAD_PROFILE, stage, operation);
    #[cfg(not(feature = "harness"))]
    {
        let _ = stage;
        operation()
    }
}

/// One kernel-family window in the detail pass.
#[inline]
pub(crate) fn detail<O: Send + 'static>(
    stage: &'static str,
    operation: impl FnOnce() -> O + Send,
) -> O {
    #[cfg(feature = "harness")]
    return window(&KERNEL_PROFILE, stage, operation);
    #[cfg(not(feature = "harness"))]
    {
        let _ = stage;
        operation()
    }
}
