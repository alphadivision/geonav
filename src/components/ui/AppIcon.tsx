'use client';

import React from 'react';
import {
  ArrowLeftIcon,
  HomeIcon,
  QuestionMarkCircleIcon,
} from '@heroicons/react/24/outline';

type IconVariant = 'outline' | 'solid';

// Explicit named imports (only the icons this app actually renders) instead
// of `import * as HeroIcons` + a dynamic string lookup — the wildcard import
// pulled in the entire icon set (~74KB gzip) into every route that imports
// this file, including the map, since a dynamic `iconSet[name]` lookup
// defeats tree-shaking. Add new icons here explicitly as they're needed.
const OUTLINE_ICONS = {
  ArrowLeftIcon,
  HomeIcon,
  QuestionMarkCircleIcon,
};

interface IconProps {
    name: string;
    variant?: IconVariant;
    size?: number;
    className?: string;
    onClick?: () => void;
    disabled?: boolean;
    [key: string]: any;
}

function Icon({
    name,
    variant = 'outline',
    size = 24,
    className = '',
    onClick,
    disabled = false,
    ...props
}: IconProps) {
    void variant; // only the outline set is used anywhere in this app today
    const IconComponent = OUTLINE_ICONS[name as keyof typeof OUTLINE_ICONS] as React.ComponentType<any>;

    if (!IconComponent) {
        return (
            <QuestionMarkCircleIcon
                width={size}
                height={size}
                className={`text-gray-400 ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
                onClick={disabled ? undefined : onClick}
                {...props}
            />
        );
    }

    return (
        <IconComponent
            width={size}
            height={size}
            className={`${disabled ? 'opacity-50 cursor-not-allowed' : onClick ? 'cursor-pointer hover:opacity-80' : ''} ${className}`}
            onClick={disabled ? undefined : onClick}
            {...props}
        />
    );
}

export default Icon;
