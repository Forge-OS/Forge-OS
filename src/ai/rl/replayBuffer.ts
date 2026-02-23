/**
 * Replay Buffer for Experience Replay
 *
 * Stores agent experiences and samples random batches for training
 */

import type { Experience } from './types';

export class ReplayBuffer {
  private buffer: Experience[];
  private maxSize: number;
  private position: number;

  constructor(maxSize: number = 100000) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.position = 0;
  }

  /**
   * Add experience to buffer
   */
  add(experience: Experience) {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(experience);
    } else {
      // Circular buffer: overwrite oldest
      this.buffer[this.position] = experience;
    }

    this.position = (this.position + 1) % this.maxSize;
  }

  /**
   * Sample random batch
   */
  sample(batchSize: number): Experience[] {
    if (this.buffer.length < batchSize) {
      // Not enough experiences yet
      return this.buffer.slice();
    }

    const batch: Experience[] = [];
    const indices = new Set<number>();

    while (indices.size < batchSize) {
      const idx = Math.floor(Math.random() * this.buffer.length);
      if (!indices.has(idx)) {
        indices.add(idx);
        batch.push(this.buffer[idx]);
      }
    }

    return batch;
  }

  /**
   * Get buffer size
   */
  size(): number {
    return this.buffer.length;
  }

  /**
   * Clear buffer
   */
  clear() {
    this.buffer = [];
    this.position = 0;
  }

  /**
   * Get all experiences (for saving)
   */
  getAll(): Experience[] {
    return [...this.buffer];
  }
}
