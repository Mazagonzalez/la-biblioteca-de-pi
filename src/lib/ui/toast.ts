/** Aviso discreto que aparece y se va solo. */
export class Toast {
    private readonly root: HTMLElement;
    private readonly title: HTMLElement;
    private readonly detail: HTMLElement;
    private timer = 0;

    constructor(root: HTMLElement) {
        this.root = root;
        const title = root.querySelector<HTMLElement>(
            '[data-toast-title]',
        );
        const detail = root.querySelector<HTMLElement>(
            '[data-toast-detail]',
        );
        if (!title || !detail) throw new Error('Toast incompleto');
        this.title = title;
        this.detail = detail;
    }

    show(title: string, detail: string, ms = 5200): void {
        this.title.textContent = title;
        this.detail.textContent = detail;
        this.root.dataset.visible = 'true';
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => {
            this.root.dataset.visible = 'false';
        }, ms);
    }
}
