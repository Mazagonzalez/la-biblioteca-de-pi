import { PiSynth } from '../audio';
import type { PiStream } from '../engine';
import { fmtInt } from '../format';
import type { ModeView } from '../modes';
import { DIGIT_PALETTE } from '../palette';
import { $ } from './dom';

/** Dígitos visibles a cada lado del que suena. */
const SIDE = 9;

/** Modo Sonido: cada decimal es una nota; se resalta la que suena. */
export class SoundModeView implements ModeView {
    private readonly synth = new PiSynth();
    private readonly section: HTMLElement;
    private readonly el: {
        play: HTMLButtonElement;
        tape: HTMLElement;
        cells: HTMLSpanElement[];
        pos: HTMLElement;
        hint: HTMLElement;
        ring: HTMLElement;
        volume: HTMLInputElement;
        tempo: HTMLInputElement;
        tempoLabel: HTMLElement;
    };
    private stream: PiStream | null = null;
    private frame = 0;
    private shown = -1;

    constructor(section: HTMLElement) {
        this.section = section;
        const tape = $(section, '[data-tape]');
        const cells: HTMLSpanElement[] = [];
        for (let i = -SIDE; i <= SIDE; i++) {
            const cell = document.createElement('span');
            cell.className = 'tape-cell';
            cell.style.setProperty('--d', String(Math.abs(i)));
            if (i === 0) cell.classList.add('is-now');
            tape.append(cell);
            cells.push(cell);
        }
        this.el = {
            play: $<HTMLButtonElement>(section, '[data-play]'),
            tape,
            cells,
            pos: $(section, '[data-sound-pos]'),
            hint: $(section, '[data-sound-hint]'),
            ring: $(section, '[data-ring]'),
            volume: $<HTMLInputElement>(section, '[data-volume]'),
            tempo: $<HTMLInputElement>(section, '[data-tempo]'),
            tempoLabel: $(section, '[data-tempo-label]'),
        };

        this.synth.setVolume(Number(this.el.volume.value) / 100);
        this.synth.setTempo(Number(this.el.tempo.value));
        this.el.tempoLabel.textContent = this.el.tempo.value;

        this.el.play.addEventListener(
            'click',
            () => void this.toggle(),
        );
        this.el.volume.addEventListener('input', () => {
            this.synth.setVolume(Number(this.el.volume.value) / 100);
        });
        this.el.tempo.addEventListener('input', () => {
            this.synth.setTempo(Number(this.el.tempo.value));
            this.el.tempoLabel.textContent = this.el.tempo.value;
        });
        this.synth.onStarve = (starving) => {
            this.section.dataset.starving = String(starving);
        };
    }

    private async toggle(): Promise<void> {
        if (this.synth.playing) {
            this.synth.stop();
        } else {
            await this.synth.start();
            this.loop();
        }
        this.syncState();
    }

    private syncState(): void {
        const playing = this.synth.playing;
        this.section.dataset.playing = String(playing);
        this.el.play.setAttribute('aria-pressed', String(playing));
        this.el.play.setAttribute(
            'aria-label',
            playing ? 'Detener el sonido' : 'Escuchar π',
        );
        this.el.hint.textContent = playing
            ? 'Cada decimal es una nota de la escala pentatónica'
            : this.synth.cursor > 0
              ? 'En pausa · pulsa para seguir escuchando'
              : 'Pulsa para escuchar π';
    }

    private loop = (): void => {
        cancelAnimationFrame(this.frame);
        const tick = () => {
            const note = this.synth.current();
            if (note) this.show(note.index, true);
            if (this.synth.playing)
                this.frame = requestAnimationFrame(tick);
        };
        this.frame = requestAnimationFrame(tick);
    };

    /** Pinta la cinta centrada en `index`. */
    private show(index: number, pulse: boolean): void {
        const stream = this.stream;
        if (!stream) return;
        this.shown = index;
        const { cells } = this.el;
        for (let i = 0; i < cells.length; i++) {
            const at = index + i - SIDE;
            cells[i].textContent =
                at >= 0 && at < stream.length
                    ? String(stream.store.at(at))
                    : ' ';
        }
        this.el.pos.textContent = `decimal n.º ${fmtInt(index + 1)}`;
        if (pulse) {
            const digit = stream.store.at(index);
            const ring = this.el.ring;
            ring.style.setProperty('--ring', DIGIT_PALETTE[digit]);
            ring.classList.remove('is-on');
            // Fuerza el reinicio de la animación.
            void ring.offsetWidth;
            ring.classList.add('is-on');
            const now = cells[SIDE];
            now.classList.remove('is-pop');
            void now.offsetWidth;
            now.classList.add('is-pop');
        }
    }

    activate(stream: PiStream): void {
        this.stream = stream;
        this.synth.setSource({
            get length() {
                return stream.length;
            },
            at: (i) => stream.store.at(i),
        });
        if (this.shown < 0 && stream.length > 0) this.show(0, false);
        this.syncState();
    }

    deactivate(): void {
        this.synth.stop();
        cancelAnimationFrame(this.frame);
        this.syncState();
    }

    update(stream: PiStream): void {
        if (this.shown < 0 && stream.length > 0) this.show(0, false);
    }
}
