import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "@/lib/store";

describe("useProjectStore", () => {
  beforeEach(() => {
    // Reset store state
    useProjectStore.setState({
      currentProjectId: null,
      currentProjectCode: null,
    });
  });

  it("starts with null project", () => {
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBeNull();
    expect(state.currentProjectCode).toBeNull();
  });

  it("sets current project", () => {
    useProjectStore.getState().setCurrentProject("proj-1", "AE");
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBe("proj-1");
    expect(state.currentProjectCode).toBe("AE");
  });

  it("switches between projects", () => {
    const store = useProjectStore.getState();
    store.setCurrentProject("proj-1", "AE");
    store.setCurrentProject("proj-2", "DN");
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBe("proj-2");
    expect(state.currentProjectCode).toBe("DN");
  });
});
