import { describe, it, expect, beforeEach } from "vitest";
import { useProjectStore } from "@/lib/store";

describe("useProjectStore", () => {
  beforeEach(() => {
    useProjectStore.setState({
      currentProjectId: null,
      currentProjectCode: null,
      currentProjectName: null,
      currentProjectType: null,
    });
  });

  it("starts with null project", () => {
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBeNull();
    expect(state.currentProjectCode).toBeNull();
  });

  it("sets current project", () => {
    useProjectStore.getState().setCurrentProject("proj-1", "AE", "Bright Data AE", "FULL", "ADMIN", []);
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBe("proj-1");
    expect(state.currentProjectCode).toBe("AE");
    expect(state.currentProjectName).toBe("Bright Data AE");
    expect(state.currentProjectType).toBe("FULL");
  });

  it("switches between projects", () => {
    const store = useProjectStore.getState();
    store.setCurrentProject("proj-1", "AE", "Bright Data AE", "FULL", "ADMIN", []);
    store.setCurrentProject("proj-2", "DN", "Da Nang Team", "PAYPAL_ONLY", "USER", []);
    const state = useProjectStore.getState();
    expect(state.currentProjectId).toBe("proj-2");
    expect(state.currentProjectCode).toBe("DN");
    expect(state.currentProjectType).toBe("PAYPAL_ONLY");
  });
});
