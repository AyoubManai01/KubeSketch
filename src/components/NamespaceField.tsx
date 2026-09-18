import { useEffect, useMemo, useRef, useState } from 'react';

interface Props {
    value: string;
    onChange: (value: string) => void;
    options: string[];
    placeholder?: string;
}

/**
 * Namespace picker: a text input that keeps free-text entry (a brand-new
 * namespace can be typed) AND offers a reliable dropdown of known namespaces.
 * Rendered as a real DOM listbox — no native datalist, which Chromium breaks
 * inside the modal's transformed/filtered ancestors.
 */
export default function NamespaceField({ value, onChange, options, placeholder }: Props) {
    const [open, setOpen] = useState(false);
    const [typing, setTyping] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const rootRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const filtered = useMemo(() => {
        if (!typing) return options;
        const q = value.trim().toLowerCase();
        if (!q) return options;
        return options.filter((o) => o.toLowerCase().includes(q));
    }, [options, value, typing]);

    useEffect(() => {
        if (!open) return;
        const onDocMouseDown = (e: MouseEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
                setOpen(false);
                setTyping(false);
            }
        };
        const onDocKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                // Capture-phase listener: runs before the modal's own document
                // Escape-close listener, so the first Escape only closes the
                // dropdown and the modal closes on the next one.
                e.stopImmediatePropagation();
                setOpen(false);
                setTyping(false);
            }
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onDocKeyDown, true);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onDocKeyDown, true);
        };
    }, [open]);

    const commit = (opt: string) => {
        onChange(opt);
        setTyping(false);
        setOpen(false);
        inputRef.current?.focus();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const count = filtered.length;
            if (!open) {
                setTyping(false);
                setOpen(true);
                setActiveIndex(e.key === 'ArrowDown' ? 0 : Math.max(count - 1, 0));
            } else if (count > 0) {
                setActiveIndex((i) =>
                    e.key === 'ArrowDown' ? (i + 1) % count : (i - 1 + count) % count
                );
            }
        } else if (e.key === 'Enter') {
            if (open && filtered.length > 0 && filtered[activeIndex]) {
                e.preventDefault();
                commit(filtered[activeIndex]);
            } else if (open) {
                setOpen(false);
                setTyping(false);
            }
        } else if (e.key === 'Tab') {
            setOpen(false);
            setTyping(false);
        }
    };

    return (
        <div className="namespace-field" ref={rootRef}>
            <input
                ref={inputRef}
                className="modal-field__input namespace-field__input"
                value={value}
                onChange={(e) => {
                    setTyping(true);
                    onChange(e.target.value);
                    if (!open) setOpen(true);
                }}
                onFocus={() => {
                    setTyping(false);
                    setOpen(true);
                }}
                onMouseDown={() => {
                    // A focused input fires no focus event on re-click — reopen
                    // the dropdown so repeated clicks keep working.
                    if (document.activeElement === inputRef.current) setOpen(true);
                }}
                onKeyDown={handleKeyDown}
                placeholder={placeholder ?? 'choose or type a namespace'}
            />
            <button
                type="button"
                className={`namespace-field__chevron${open ? ' namespace-field__chevron--open' : ''}`}
                onClick={() => setOpen((o) => !o)}
                onMouseDown={(e) => e.preventDefault()}
                tabIndex={-1}
                title="Choose a namespace"
                aria-label="Choose a namespace"
            >
                <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    width="12"
                    height="12"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                >
                    <polyline points="6 9 12 15 18 9" />
                </svg>
            </button>
            {open && (
                <ul className="namespace-field__list" role="listbox">
                    {filtered.length === 0 ? (
                        <li className="namespace-field__empty">No matching namespaces</li>
                    ) : (
                        filtered.map((opt, i) => (
                            <li
                                key={opt}
                                role="option"
                                aria-selected={i === activeIndex}
                                className={`namespace-field__option${i === activeIndex ? ' namespace-field__option--active' : ''}`}
                                onMouseEnter={() => setActiveIndex(i)}
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    commit(opt);
                                }}
                            >
                                {opt}
                            </li>
                        ))
                    )}
                </ul>
            )}
        </div>
    );
}