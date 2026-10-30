/** One native token through the BSF's gate (gate). */
export interface GateReading {
  /** [768], x = s · (t − μ): the coordinates of the frames. */
  calibrated: Float32Array;
  /** [32], the winners, strongest first, ranked as read_image ranks them. */
  blocks: Uint16Array;
  /** [32, 3], gain-free codes F_gᵀ x. */
  codes: Float32Array;
  /** [32], the codes' lengths. */
  norms: Float32Array;
  /** γ, the model's one learned gain, used only to rebuild the token. */
  gain: number;
  /** [768], γ · Σ_k F_k c_k, in calibrated coordinates. */
  reconstruction: Float32Array;
  /** ‖x − reconstruction‖ / ‖x‖. */
  residual: number;
}
