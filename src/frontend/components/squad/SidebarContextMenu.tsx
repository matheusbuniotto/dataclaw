import React, { useEffect, useRef } from 'react';

export interface SidebarMenuTarget {
    x: number;
    y: number;
    folderId?: string;
    folderName?: string;
    opener: HTMLElement | null;
}

export function SidebarContextMenu({
    target,
    dark,
    disabled,
    close,
    createGroup,
    createBot,
    manage,
}: {
    target: SidebarMenuTarget;
    dark: boolean;
    disabled: boolean;
    close: (restoreFocus?: boolean) => void;
    createGroup: () => void;
    createBot: () => void;
    manage: () => void;
}) {
    const menu = useRef<HTMLDivElement>(null);

    useEffect(() => {
        menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, []);

    useEffect(() => {
        const dismiss = (event: PointerEvent) => {
            if (!menu.current?.contains(event.target as Node)) close();
        };
        const hide = () => close();
        document.addEventListener('pointerdown', dismiss);
        window.addEventListener('resize', hide);
        document.addEventListener('scroll', hide, true);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            window.removeEventListener('resize', hide);
            document.removeEventListener('scroll', hide, true);
        };
    }, [close]);

    const item =
        'team-control truncate w-full rounded-md px-3 py-2 text-left text-xs hover:bg-neutral-500/10 focus:bg-neutral-500/10 disabled:opacity-40 transition-colors flex items-center gap-2';

    return (
        <div
            ref={menu}
            role="menu"
            aria-label="Team actions"
            className={`team-context-menu fixed z-50 w-52 rounded-xl border p-1 shadow-2xl backdrop-blur-md ${
                dark ? 'bg-[#18191e]/95 border-white/10 text-neutral-200' : 'bg-white/95 border-neutral-200 text-neutral-800'
            }`}
            style={{
                left: Math.max(8, Math.min(target.x, window.innerWidth - 216)),
                top: Math.max(8, Math.min(target.y, window.innerHeight - 148)),
            }}
            onKeyDown={(event) => {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopPropagation();
                    close(true);
                }
                if (event.key === 'Tab') close();
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const items = Array.from(
                    menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
                );
                const index = items.findIndex((el) => el === document.activeElement);
                const next =
                    event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                        ? items.length - 1
                        : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
                items[next]?.focus();
            }}
        >
            <button
                role="menuitem"
                disabled={disabled}
                className={item}
                onClick={() => {
                    close();
                    createGroup();
                }}
            >
                <span>📁</span> New Folder
            </button>
            <button
                role="menuitem"
                disabled={disabled}
                className={item}
                onClick={() => {
                    close();
                    createBot();
                }}
            >
                <span>🤖</span> {target.folderName ? `Add Specialist to ${target.folderName}` : 'New Specialist'}
            </button>
            <button
                role="menuitem"
                className={item}
                onClick={() => {
                    close();
                    manage();
                }}
            >
                <span>👥</span> Squad Org View
            </button>
        </div>
    );
}
