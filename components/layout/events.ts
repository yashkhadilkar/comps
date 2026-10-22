// The sidebar's "New question" button tells the research workspace to reset itself.
export const NEW_QUESTION_EVENT = "comps:new-question";

// Fired by the research workspace when a question is accepted into a thread (new or continued), so the sidebar's
// recent list can show or re-rank it immediately instead of waiting for the server to re-render.
export const THREAD_ACTIVITY_EVENT = "comps:thread-activity";
export type ThreadActivity = { id: string; title: string };
