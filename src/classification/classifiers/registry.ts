import { TransactionClassifier } from '../../types';
import { HouseRentalClassifier } from './house-rental';

export class ClassifierRegistry {
  private classifiers: Map<string, TransactionClassifier> = new Map();

  constructor(initialClassifiers: TransactionClassifier[] = [new HouseRentalClassifier()]) {
    for (const classifier of initialClassifiers) {
      this.register(classifier);
    }
  }

  register(classifier: TransactionClassifier): this {
    this.classifiers.set(classifier.id, classifier);
    return this;
  }

  get(id: string): TransactionClassifier | undefined {
    return this.classifiers.get(id);
  }

  has(id: string): boolean {
    return this.classifiers.has(id);
  }
}

export const defaultClassifierRegistry = new ClassifierRegistry();
