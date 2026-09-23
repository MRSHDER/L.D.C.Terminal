/** Simple living needs. Values are 0..1 and change with time + player actions. */

export interface NeedsSnapshot {
  readonly hunger: number;
  readonly energy: number;
}

export class NeedsSystem {
  private hunger = 0.32;
  private energy = 0.78;

  snapshot(): NeedsSnapshot {
    return { hunger: this.hunger, energy: this.energy };
  }

  update(dtSec: number, state: string, moving: boolean): void {
    this.hunger = clamp01(this.hunger + 0.016 * dtSec);
    if (state === 'Sleep') this.energy = clamp01(this.energy + 0.12 * dtSec);
    else if (moving || state === 'Walk' || state === 'Approach' || state === 'Retreat') {
      this.energy = clamp01(this.energy - 0.045 * dtSec);
    } else {
      this.energy = clamp01(this.energy + 0.012 * dtSec);
    }
    if (this.hunger > 0.72) this.energy = clamp01(this.energy - 0.02 * dtSec);
  }

  feed(amount = 0.42): void {
    this.hunger = clamp01(this.hunger - amount);
  }

  reset(): void {
    this.hunger = 0.32;
    this.energy = 0.78;
  }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
