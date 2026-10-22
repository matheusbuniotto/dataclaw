import { useState } from "react";
import { Play, X } from "lucide-react";

export function LaunchModal({
    agentName,
    busy,
    onClose,
    onLaunch,
}: {
    agentName: string;
    busy: boolean;
    onClose: () => void;
    onLaunch: (goal: string) => void;
}) {
    const [goal, setGoal] = useState("");
    const [error, setError] = useState("");

    return (
        <div
            className="modal-backdrop"
            onMouseDown={(event) => event.target === event.currentTarget && onClose()}
        >
            <div className="modal" role="dialog" aria-modal="true">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                        <div className="eyebrow">ASK {agentName.toUpperCase()}</div>
                        <h2>What should {agentName} explore?</h2>
                        <p>The turn is admitted to the durable conversation and can resume after a restart.</p>
                    </div>
                    <button className="icon-button" onClick={onClose} aria-label="Close">
                        <X size={15} />
                    </button>
                </div>

                <label htmlFor="task-goal">Task</label>
                <textarea
                    id="task-goal"
                    value={goal}
                    onChange={(event) => {
                        setGoal(event.target.value);
                        setError("");
                    }}
                    placeholder="For example: list Unity Catalog schemas in samples and profile one table."
                />
                {error && <div style={{ color: "#b15449", fontSize: 10, marginTop: 6 }}>{error}</div>}

                <div className="modal-footer">
                    <button className="button-secondary" onClick={onClose}>Cancel</button>
                    <button
                        className="button-primary"
                        disabled={busy}
                        onClick={() => (goal.trim() ? onLaunch(goal.trim()) : setError("Add a task to continue."))}
                    >
                        <Play size={13} /> {busy ? "Sending…" : `Ask ${agentName}`}
                    </button>
                </div>
            </div>
        </div>
    );
}
