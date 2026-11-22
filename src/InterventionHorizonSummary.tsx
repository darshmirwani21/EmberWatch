import type { interventionComparison } from '../shared/interventionSimulation';
import { decimal, Disclosure } from './ui';

export function InterventionHorizonSummary({ comparison, end }: {
  comparison: ReturnType<typeof interventionComparison>; end: string;
}) {
  return <Disclosure title={'End of run · ' + end}>
    <div className="history-numbers">
      <div><small>Final baseline</small><strong>{decimal(comparison.baselineAcres, 2)} ac</strong></div>
      <div><small>Final intervention</small><strong>{decimal(comparison.interventionAcres, 2)} ac</strong></div>
      <div><small>Final area difference</small><strong>{decimal(comparison.differenceAcres, 2)} ac</strong></div>
      <div><small>Final area reduction</small><strong>{decimal(comparison.reductionPercent, 2)}%</strong></div>
      <div><small>Final model-to-model IoU</small><strong>{decimal(comparison.iou * 100, 2)}%</strong></div>
    </div>
  </Disclosure>;
}
