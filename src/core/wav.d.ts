export interface WaveStats {
  peakDb: number;
  rmsDb: number;
  clipped: boolean;
  seconds: number;
  zeroCrossRate: number;
}

export declare function toChannels(buffer: AudioBuffer): Float32Array[];
export declare function trimTail(
  channels: Float32Array[],
  sampleRate: number,
  options?: { floorDb?: number; tailMs?: number }
): Float32Array[];
export declare function normalize(channels: Float32Array[], targetDb?: number): Float32Array[];
export declare function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer;
export declare function analyze(channels: Float32Array[], sampleRate: number): WaveStats;
