import type { PiStream } from '../engine';
import type { ModeView } from '../modes';
import { TextViewer } from '../renderers/text-viewer';
import { $ } from './dom';

/** Modos Dígitos y Letras: visor de texto virtualizado. */
export class TextModeView implements ModeView {
    readonly viewer: TextViewer;
    private readonly followBtn: HTMLButtonElement;
    private stream: PiStream | null = null;

    constructor(section: HTMLElement) {
        this.viewer = new TextViewer($(section, '[data-viewer]'));
        this.followBtn = $<HTMLButtonElement>(
            section,
            '[data-follow]',
        );
        this.viewer.onFollowChange = (follow) => {
            this.followBtn.dataset.visible = String(!follow);
        };
        this.followBtn.addEventListener('click', () => {
            this.viewer.clearHighlight();
            this.viewer.scrollToEnd();
        });
    }

    activate(stream: PiStream): void {
        if (this.stream !== stream) {
            this.stream = stream;
            this.viewer.setStream(stream);
        }
        this.viewer.invalidate();
    }

    deactivate(): void {}

    update(): void {
        this.viewer.invalidate();
    }

    /** Salta a un resultado de búsqueda y lo resalta. */
    reveal(index: number, length: number): void {
        this.viewer.setHighlight(index, length);
        this.viewer.scrollToIndex(index);
    }
}
