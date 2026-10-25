import React from 'react';
import type { FC } from 'react';
import type { SpecialistShape } from './types';

export interface SpecialistAvatarProps {
    shape: SpecialistShape;
    color: string;
    size?: number;
    className?: string;
    animated?: boolean;
    working?: boolean;
    entering?: boolean;
    eyesLooking?: 'normal' | 'left' | 'right' | 'up' | 'happy';
    isInteracting?: boolean;
}

export const SPECIALIST_COLORS = [
    { id: 'cyan', name: 'Databricks Cyan', hex: '#06B6D4', ringHex: '#22D3EE' },
    { id: 'emerald', name: 'Analyst Emerald', hex: '#10B981', ringHex: '#34D399' },
    { id: 'indigo', name: 'Deep Indigo', hex: '#6366F1', ringHex: '#818CF8' },
    { id: 'amber', name: 'Auditor Amber', hex: '#F59E0B', ringHex: '#FBBF24' },
    { id: 'rose', name: 'Skeptic Crimson', hex: '#EF4444', ringHex: '#F87171' },
    { id: 'orange', name: 'Tangerine Orange', hex: '#F97316', ringHex: '#FB923C' },
    { id: 'blue', name: 'Cobalt Blue', hex: '#3B82F6', ringHex: '#60A5FA' },
    { id: 'purple', name: 'Deep Purple', hex: '#8B5CF6', ringHex: '#A78BFA' },
    { id: 'slate', name: 'Stealth Slate', hex: '#64748B', ringHex: '#94A3B8' },
];
export const BOT_COLORS = SPECIALIST_COLORS;

export const SPECIALIST_SHAPES: { id: SpecialistShape; label: string }[] = [
    { id: 'droplet', label: 'Droplet' },
    { id: 'round', label: 'Round' },
    { id: 'squircle', label: 'Squircle' },
    { id: 'pebble', label: 'Pebble' },
    { id: 'triangle', label: 'Triangle' },
    { id: 'hexagon', label: 'Hexagon' },
    { id: 'cloud', label: 'Cloud' },
    { id: 'tear', label: 'Teardrop' },
];
export const BOT_SHAPES = SPECIALIST_SHAPES;

export const SpecialistAvatar: FC<SpecialistAvatarProps> = ({
    shape,
    color,
    size = 40,
    className = '',
    animated = false,
    working = false,
    entering = false,
    eyesLooking = 'normal',
    isInteracting = false,
}) => {
    const renderShapePath = () => {
        switch (shape) {
            case 'droplet':
                return (
                    <path
                        d="M 50 12 C 50 12 18 52 18 68 C 18 84 32 94 50 94 C 68 94 82 84 82 68 C 82 52 50 12 50 12 Z"
                        fill={color}
                    />
                );
            case 'round':
                return <circle cx="50" cy="50" r="42" fill={color} />;
            case 'squircle':
                return (
                    <rect
                        x="12"
                        y="12"
                        width="76"
                        height="76"
                        rx="28"
                        ry="28"
                        fill={color}
                    />
                );
            case 'pebble':
                return (
                    <path
                        d="M 24 32 C 38 20 62 18 80 28 C 94 38 92 62 84 76 C 72 90 40 92 24 84 C 10 74 10 44 24 32 Z"
                        fill={color}
                    />
                );
            case 'triangle':
                return (
                    <path
                        d="M 44 18 C 47 13 53 13 56 18 L 84 68 C 87 74 83 82 76 82 L 24 82 C 17 82 13 74 16 68 Z"
                        fill={color}
                    />
                );
            case 'hexagon':
                return (
                    <path
                        d="M 32 16 L 68 16 C 74 16 79 19 82 25 L 94 50 C 97 55 97 61 94 66 L 82 85 C 79 90 74 93 68 93 L 32 93 C 26 93 21 90 18 85 L 6 66 C 3 61 3 55 6 50 L 18 25 C 21 19 26 16 32 16 Z"
                        fill={color}
                    />
                );
            case 'cloud':
                return (
                    <path
                        d="M 32 30 C 34 18 48 14 58 18 C 68 14 82 20 84 32 C 94 38 94 56 86 66 C 88 80 74 90 60 88 C 48 94 32 90 26 80 C 14 78 12 60 18 50 C 12 38 22 28 32 30 Z"
                        fill={color}
                    />
                );
            case 'tear':
            default:
                return (
                    <path
                        d="M 48 14 C 52 14 55 18 57 23 C 67 44 86 54 86 70 C 86 85 71 94 50 94 C 29 94 14 84 14 68 C 14 50 36 34 48 14 Z"
                        fill={color}
                    />
                );
        }
    };

    let eyeOffsetX = 0;
    let eyeOffsetY = 0;
    if (eyesLooking === 'left') eyeOffsetX = -3;
    if (eyesLooking === 'right') eyeOffsetX = 3;
    if (eyesLooking === 'up') eyeOffsetY = -3;

    return (
        <div
            aria-hidden="true"
            data-working={working || isInteracting}
            data-created={entering}
            className={`specialist-avatar ${entering ? 'specialist-avatar-entering' : ''} relative inline-flex items-center justify-center shrink-0 transition-transform duration-200 select-none ${
                animated ? 'hover:scale-105 active:scale-95' : ''
            } ${className}`}
            style={{ width: size, height: size }}
        >
            <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
                {renderShapePath()}
                <g transform={`translate(${eyeOffsetX}, ${eyeOffsetY})`} className="specialist-avatar-eyes">
                    <rect
                        x="36"
                        y="54"
                        width="6.5"
                        height="15"
                        rx="3.25"
                        ry="3.25"
                        fill="#FFFFFF"
                        transform="rotate(18, 39, 61)"
                    />
                    <rect
                        x="57"
                        y="54"
                        width="6.5"
                        height="15"
                        rx="3.25"
                        ry="3.25"
                        fill="#FFFFFF"
                        transform="rotate(18, 60, 61)"
                    />
                </g>
            </svg>
        </div>
    );
};

export const BotAvatar = SpecialistAvatar;
