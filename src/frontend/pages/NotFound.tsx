import { LifeBuoy } from "lucide-react";

export function NotFound({ goHome }: { goHome: () => void }) {
    return (
        <div className="page-wrap">
            <div className="panel empty-state" style={{ marginTop: 50 }}>
                <LifeBuoy size={25} />
                <b>This page is not in the workspace</b>
                <span>Head back to your overview to pick up where you left off.</span>
                <button
                    className="button-primary"
                    style={{ margin: "16px auto 0" }}
                    onClick={goHome}
                >
                    Return to overview
                </button>
            </div>
        </div>
    );
}
