/**
 * Simple Neural Network for DQN
 *
 * Lightweight implementation for browser/Node.js
 * Can be replaced with TensorFlow.js for production
 */

import type { NeuralNetworkConfig } from './types';

type Matrix = number[][];
type Vector = number[];

export class NeuralNetwork {
  private config: NeuralNetworkConfig;
  private weights: Matrix[];
  private biases: Vector[];
  private velocities: Matrix[];      // For momentum
  private biasVelocities: Vector[];

  constructor(config: NeuralNetworkConfig) {
    this.config = config;
    this.weights = [];
    this.biases = [];
    this.velocities = [];
    this.biasVelocities = [];

    this.initializeWeights();
  }

  /**
   * Initialize weights using Xavier/He initialization
   */
  private initializeWeights() {
    const layers = [this.config.inputSize, ...this.config.hiddenLayers, this.config.outputSize];

    for (let i = 0; i < layers.length - 1; i++) {
      const inputSize = layers[i];
      const outputSize = layers[i + 1];

      // Xavier initialization
      const scale = Math.sqrt(2 / (inputSize + outputSize));

      // Weight matrix: [outputSize x inputSize]
      const weightMatrix: Matrix = [];
      for (let j = 0; j < outputSize; j++) {
        weightMatrix[j] = [];
        for (let k = 0; k < inputSize; k++) {
          weightMatrix[j][k] = (Math.random() * 2 - 1) * scale;
        }
      }

      this.weights.push(weightMatrix);
      this.velocities.push(weightMatrix.map(row => row.map(() => 0)));

      // Bias vector
      this.biases.push(new Array(outputSize).fill(0));
      this.biasVelocities.push(new Array(outputSize).fill(0));
    }
  }

  /**
   * Forward pass
   */
  predict(input: Vector): Vector {
    let activation = input;

    for (let i = 0; i < this.weights.length; i++) {
      // Linear: z = W * x + b
      const z = this.matMul(this.weights[i], activation, this.biases[i]);

      // Activation function
      if (i < this.weights.length - 1) {
        // Hidden layers: use configured activation
        activation = this.activate(z, this.config.activation);

        // Dropout (only during training, not inference)
        // Skip for now in prediction
      } else {
        // Output layer: linear (for Q-values)
        activation = z;
      }
    }

    return activation;
  }

  /**
   * Train on batch using gradient descent
   */
  train(inputs: Vector[], targets: Vector[], learningRate: number = this.config.learningRate) {
    const batchSize = inputs.length;

    // Accumulate gradients
    const weightGrads = this.weights.map(w => w.map(row => row.map(() => 0)));
    const biasGrads = this.biases.map(b => b.map(() => 0));

    for (let b = 0; b < batchSize; b++) {
      const { weightDeltas, biasDeltas } = this.backpropagate(inputs[b], targets[b]);

      // Accumulate
      for (let i = 0; i < weightDeltas.length; i++) {
        for (let j = 0; j < weightDeltas[i].length; j++) {
          for (let k = 0; k < weightDeltas[i][j].length; k++) {
            weightGrads[i][j][k] += weightDeltas[i][j][k];
          }
        }
        for (let j = 0; j < biasDeltas[i].length; j++) {
          biasGrads[i][j] += biasDeltas[i][j];
        }
      }
    }

    // Update weights with momentum
    const momentum = 0.9;

    for (let i = 0; i < this.weights.length; i++) {
      for (let j = 0; j < this.weights[i].length; j++) {
        for (let k = 0; k < this.weights[i][j].length; k++) {
          const grad = weightGrads[i][j][k] / batchSize;
          this.velocities[i][j][k] = momentum * this.velocities[i][j][k] - learningRate * grad;
          this.weights[i][j][k] += this.velocities[i][j][k];
        }
      }

      for (let j = 0; j < this.biases[i].length; j++) {
        const grad = biasGrads[i][j] / batchSize;
        this.biasVelocities[i][j] = momentum * this.biasVelocities[i][j] - learningRate * grad;
        this.biases[i][j] += this.biasVelocities[i][j];
      }
    }
  }

  /**
   * Backpropagation to compute gradients
   */
  private backpropagate(input: Vector, target: Vector) {
    // Forward pass with activations saved
    const activations: Vector[] = [input];
    const zValues: Vector[] = [];

    let activation = input;

    for (let i = 0; i < this.weights.length; i++) {
      const z = this.matMul(this.weights[i], activation, this.biases[i]);
      zValues.push(z);

      if (i < this.weights.length - 1) {
        activation = this.activate(z, this.config.activation);
      } else {
        activation = z;
      }

      activations.push(activation);
    }

    // Backward pass
    const weightDeltas: Matrix[] = [];
    const biasDeltas: Vector[] = [];

    // Output layer error
    let delta = activations[activations.length - 1].map((a, i) => a - target[i]);

    for (let i = this.weights.length - 1; i >= 0; i--) {
      // Weight gradients: delta * activation^T
      const weightDelta: Matrix = [];
      for (let j = 0; j < delta.length; j++) {
        weightDelta[j] = [];
        for (let k = 0; k < activations[i].length; k++) {
          weightDelta[j][k] = delta[j] * activations[i][k];
        }
      }
      weightDeltas.unshift(weightDelta);

      // Bias gradients
      biasDeltas.unshift([...delta]);

      // Propagate error to previous layer
      if (i > 0) {
        const prevDelta: Vector = new Array(this.weights[i][0].length).fill(0);
        for (let j = 0; j < this.weights[i][0].length; j++) {
          let sum = 0;
          for (let k = 0; k < this.weights[i].length; k++) {
            sum += this.weights[i][k][j] * delta[k];
          }
          prevDelta[j] = sum;
        }

        // Apply activation derivative
        const activationDeriv = this.activateDerivative(zValues[i - 1], this.config.activation);
        delta = prevDelta.map((d, idx) => d * activationDeriv[idx]);
      }
    }

    return { weightDeltas, biasDeltas };
  }

  /**
   * Matrix multiplication: W * x + b
   */
  private matMul(W: Matrix, x: Vector, b: Vector): Vector {
    const result: Vector = [];
    for (let i = 0; i < W.length; i++) {
      let sum = b[i];
      for (let j = 0; j < x.length; j++) {
        sum += W[i][j] * x[j];
      }
      result.push(sum);
    }
    return result;
  }

  /**
   * Activation functions
   */
  private activate(z: Vector, type: string): Vector {
    switch (type) {
      case 'relu':
        return z.map(v => Math.max(0, v));
      case 'tanh':
        return z.map(v => Math.tanh(v));
      case 'sigmoid':
        return z.map(v => 1 / (1 + Math.exp(-v)));
      default:
        return z;
    }
  }

  /**
   * Activation derivatives
   */
  private activateDerivative(z: Vector, type: string): Vector {
    switch (type) {
      case 'relu':
        return z.map(v => v > 0 ? 1 : 0);
      case 'tanh':
        const tanhZ = z.map(v => Math.tanh(v));
        return tanhZ.map(v => 1 - v * v);
      case 'sigmoid':
        const sigZ = z.map(v => 1 / (1 + Math.exp(-v)));
        return sigZ.map(v => v * (1 - v));
      default:
        return z.map(() => 1);
    }
  }

  /**
   * Get weights (for saving)
   */
  getWeights(): { weights: Matrix[], biases: Vector[] } {
    return {
      weights: this.weights.map(w => w.map(row => [...row])),
      biases: this.biases.map(b => [...b]),
    };
  }

  /**
   * Set weights (for loading)
   */
  setWeights(data: { weights: Matrix[], biases: Vector[] }) {
    this.weights = data.weights.map(w => w.map(row => [...row]));
    this.biases = data.biases.map(b => [...b]);
  }

  /**
   * Clone network
   */
  clone(): NeuralNetwork {
    const cloned = new NeuralNetwork(this.config);
    cloned.setWeights(this.getWeights());
    return cloned;
  }
}
