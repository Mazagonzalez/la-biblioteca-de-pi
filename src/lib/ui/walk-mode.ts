import type { PiStream } from '../engine';
import { fmtDecimal, fmtInt } from '../format';
import type { ModeView } from '../modes';
import { WalkCanvas } from '../renderers/walk-canvas';
import { $ } from './dom';

/** Modo Caminata: π en base 4 como caminata aleatoria. */
export class WalkModeView implements ModeView {
    private readonly walk: WalkCanvas;
    private readonly el: {
        steps: HTMLElement;
        pos: HTMLElement;
        dist: HTMLElement;
        sqrt: HTMLElement;
        auto: HTMLButtonElement;
    };

    constructor(section: HTMLElement) {
        this.walk = new WalkCanvas($(section, '[data-walk]'));
        this.el = {
            steps: $(section, '[data-w-steps]'),
            pos: $(section, '[data-w-pos]'),
            dist: $(section, '[data-w-dist]'),
            sqrt: $(section, '[data-w-sqrt]'),
            auto: $<HTMLButtonElement>(section, '[data-w-auto]'),
        };
        this.walk.onInfo = (info) => {
            this.el.steps.textContent = fmtInt(info.steps);
            this.el.pos.textContent =
                `(${fmtInt(info.x)}, ${fmtInt(info.y)})`.replace(
                    /-/g,
                    '−',
                );
            this.el.dist.textContent = fmtDecimal(info.distance, 1);
            this.el.sqrt.textContent = fmtDecimal(
                Math.sqrt(info.steps),
                1,
            );
        };
        this.walk.onAutoChange = (auto) => {
            this.el.auto.dataset.visible = String(!auto);
        };
        this.el.auto.addEventListener('click', () =>
            this.walk.setAuto(true),
        );
        $(section, '[data-zoom-in]').addEventListener('click', () =>
            this.walk.zoomBy(1.5),
        );
        $(section, '[data-zoom-out]').addEventListener('click', () =>
            this.walk.zoomBy(1 / 1.5),
        );
    }

    activate(stream: PiStream): void {
        this.walk.setStream(stream);
    }

    deactivate(): void {
        this.walk.pause();
    }

    update(): void {
        this.walk.invalidate();
    }
}
