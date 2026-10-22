// The page header every console page opens with: eyebrow, title, subtitle, and one action.
import type { ReactNode } from "react";

export function Header({
    eyebrow,
    title,
    subtitle,
    action,
}: {
    eyebrow: string;
    title: string;
    subtitle: string;
    action?: ReactNode;
}) {
    return (
        <div className="page-head">
            <div>
                <div className="eyebrow">{eyebrow}</div>
                <h1 className="page-title">{title}</h1>
                <p className="page-subtitle">{subtitle}</p>
            </div>
            {action}
        </div>
    );
}
