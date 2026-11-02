import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store/appStore";

function reset() {
  localStorage.clear();
  useAppStore.setState({
    source: "openf1",
    year: null,
    meetingKey: null,
    sessionKey: null,
    slots: [{ id: 0 }],
    selections: {},
    req: null,
    hidden: [],
    focus: null,
    revision: 0,
    visible: { speed: true, throttle: true, brake: true, rpm: true, gear: true, drsOpen: true },
  });
}

beforeEach(reset);

describe("app store", () => {
  it("cascades resets down the selection chain", () => {
    const s = useAppStore.getState();
    s.setYear(2021);
    useAppStore.setState({ meetingKey: -3 });
    s.setMeeting(-3);
    useAppStore.setState({ sessionKey: -7, req: { entries: [] } });
    expect(useAppStore.getState().year).toBe(2021);
    s.setSession(-7);
    expect(useAppStore.getState().sessionKey).toBe(-7);
    // changing the meeting resets the session but keeps the year
    s.setMeeting(-4);
    expect(useAppStore.getState().sessionKey).toBeNull();
    expect(useAppStore.getState().year).toBe(2021);
    // changing the year resets the meeting
    s.setYear(2020);
    expect(useAppStore.getState().meetingKey).toBeNull();
  });

  it("switching source clears the selection and persists the preference", () => {
    const s = useAppStore.getState();
    s.setYear(2021);
    s.setMeeting(-3);
    s.setSession(-7);
    useAppStore.setState({ req: { entries: [] }, hidden: ["-7-1-2"] });
    s.setSource("local");
    const st = useAppStore.getState();
    expect(st.source).toBe("local");
    expect(st.year).toBeNull();
    expect(st.meetingKey).toBeNull();
    expect(st.sessionKey).toBeNull();
    expect(st.req).toBeNull();
    expect(st.hidden).toEqual([]);
    const persisted = JSON.parse(localStorage.getItem("f1-telemetry-lab-ui") ?? "{}");
    expect(persisted.state.source).toBe("local");
  });

  it("toggles hidden keys and series visibility", () => {
    const s = useAppStore.getState();
    s.toggleHidden("-7-1-2");
    expect(useAppStore.getState().hidden).toEqual(["-7-1-2"]);
    s.toggleHidden("-7-1-2");
    expect(useAppStore.getState().hidden).toEqual([]);
    s.toggleSeries("speed");
    expect(useAppStore.getState().visible.speed).toBe(false);
    expect(useAppStore.getState().visible.throttle).toBe(true);
  });

  it("bumps revision only on demand", () => {
    const before = useAppStore.getState().revision;
    useAppStore.getState().bumpRevision();
    expect(useAppStore.getState().revision).toBe(before + 1);
  });

  it("caps driver slots at four and removes selections with the slot", () => {
    const s = useAppStore.getState();
    s.addSlot();
    s.addSlot();
    s.addSlot();
    expect(useAppStore.getState().slots.length).toBe(4);
    s.addSlot();
    expect(useAppStore.getState().slots.length).toBe(4);
    s.setSelection(0, null);
    s.removeSlot(0);
    const st = useAppStore.getState();
    expect(st.slots.length).toBe(3);
    expect(0 in st.selections).toBe(false);
  });
});
