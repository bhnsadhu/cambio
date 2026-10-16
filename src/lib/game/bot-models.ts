/**
 * A plain forward pass for the exported models in ./models: logistic
 * regression, a small neural net, or gradient boosted trees, each a JSON
 * file written by ml/train_call.py or ml/train_action.py. No runtime
 * dependency; the Python side checks its own predictions against the same
 * arithmetic before exporting, and bot-models.test.ts checks this file
 * against those predictions.
 */
export interface Scaled {
  features: string[];
  mean: number[];
  scale: number[];
}

export interface LogisticModel extends Scaled {
  type: "logistic";
  coef: number[];
  intercept: number;
}

export interface MlpModel extends Scaled {
  type: "mlp";
  activation: "relu" | "tanh";
  output: "sigmoid" | "identity";
  /** weights[out][in] per layer */
  layers: { weights: number[][]; bias: number[] }[];
}

export interface Tree {
  feature: number[];
  threshold: number[];
  left: number[];
  right: number[];
  value: number[];
}

export interface GbdtModel {
  type: "gbdt";
  features: string[];
  init: number;
  learningRate: number;
  trees: Tree[];
}

export type Model = LogisticModel | MlpModel | GbdtModel;

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export function predict(model: Model, x: number[]): number {
  if (x.length !== model.features.length) throw new Error(`The model takes ${model.features.length} features, not ${x.length}.`);
  if (model.type === "gbdt") {
    let out = model.init;
    for (const tree of model.trees) {
      let node = 0;
      // The trees were fit on single precision features.
      while (tree.left[node] !== -1) node = Math.fround(x[tree.feature[node]]) <= tree.threshold[node] ? tree.left[node] : tree.right[node];
      out += model.learningRate * tree.value[node];
    }
    return out;
  }
  const z = x.map((value, index) => (value - model.mean[index]) / model.scale[index]);
  if (model.type === "logistic") return sigmoid(z.reduce((sum, value, index) => sum + value * model.coef[index], model.intercept));
  let h = z;
  model.layers.forEach((layer, index) => {
    const next = layer.weights.map((row, out) => row.reduce((sum, weight, i) => sum + weight * h[i], layer.bias[out]));
    h = index < model.layers.length - 1 ? next.map((value) => model.activation === "relu" ? Math.max(0, value) : Math.tanh(value)) : next;
  });
  return model.output === "sigmoid" ? sigmoid(h[0]) : h[0];
}
