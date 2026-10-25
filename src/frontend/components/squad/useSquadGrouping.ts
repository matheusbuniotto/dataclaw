import { useEffect, useRef, useState, type DragEvent } from 'react';
import type { Specialist, SquadFolder } from './types';

const specialistTransfer = 'application/x-dataclaw-specialist';

/** Native desktop dragging; existing move menus remain the touch/keyboard path. */
export function useSquadGrouping(
    specialists: Specialist[],
    folders: SquadFolder[],
    move: (id: string, groupId: string) => Promise<void>,
    disabled = false,
    reveal?: (groupId: string) => void,
) {
    const [draggedId, setDraggedId] = useState<string | null>(null);
    const [externalDrag, setExternalDrag] = useState(false);
    const [targetId, setTargetId] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [moving, setMoving] = useState(false);
    const busy = useRef(false);

    const accepts = (event: DragEvent) =>
        !disabled && !busy.current && event.dataTransfer.types.includes(specialistTransfer);

    const clear = () => {
        setDraggedId(null);
        setTargetId(null);
        setExternalDrag(false);
    };

    useEffect(() => {
        const reset = () => {
            setDraggedId(null);
            setTargetId(null);
            setExternalDrag(false);
        };
        window.addEventListener('dragend', reset);
        window.addEventListener('drop', reset);
        return () => {
            window.removeEventListener('dragend', reset);
            window.removeEventListener('drop', reset);
        };
    }, []);

    return {
        dragActive: draggedId !== null || externalDrag,
        targetId,
        notice,
        error,
        moving,
        zone: {
            onDragEnter: (event: DragEvent) => {
                if (accepts(event)) setExternalDrag(true);
            },
            onDragLeave: (event: DragEvent) => {
                if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                ) {
                    setExternalDrag(false);
                }
            },
        },
        source: (specialist: Specialist) => ({
            draggable: !disabled && !moving,
            onDragStart: (event: DragEvent) => {
                if (disabled || busy.current) {
                    event.preventDefault();
                    return;
                }
                event.dataTransfer.setData(specialistTransfer, specialist.id);
                event.dataTransfer.effectAllowed = 'move';
                setDraggedId(specialist.id);
                setError('');
                setNotice('Drag to a folder, or to Ungrouped to remove membership.');
            },
            onDragEnd: clear,
        }),
        target: (groupId: string) => ({
            onDragOver: (event: DragEvent) => {
                if (!accepts(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setTargetId(groupId);
            },
            onDragLeave: (event: DragEvent) => {
                if (
                    !(event.relatedTarget instanceof Node) ||
                    !event.currentTarget.contains(event.relatedTarget)
                ) {
                    setTargetId((current) => (current === groupId ? null : current));
                }
            },
            onDrop: (event: DragEvent) => {
                if (!accepts(event)) return;
                event.preventDefault();
                event.stopPropagation();
                const id = event.dataTransfer.getData(specialistTransfer);
                clear();
                const specialist = specialists.find((candidate) => candidate.id === id);
                const group = groupId
                    ? folders.find((candidate) => candidate.id === groupId)
                    : { name: 'Ungrouped' };
                if (!specialist || !group) {
                    setError('The specialist or folder is no longer available. Refresh and try again.');
                    return;
                }
                if ((specialist.folderId ?? '') === groupId) return;
                busy.current = true;
                setMoving(true);
                setError('');
                setNotice(`Moving ${specialist.name} to ${group.name}…`);
                void move(id, groupId)
                    .then(() => {
                        setNotice(`Moved ${specialist.name} to ${group.name}.`);
                        reveal?.(groupId);
                    })
                    .catch((failure) => {
                        setError(failure instanceof Error ? failure.message : 'Could not move specialist.');
                    })
                    .finally(() => {
                        busy.current = false;
                        setMoving(false);
                    });
            },
        }),
    };
}

export const useBotGrouping = useSquadGrouping;
