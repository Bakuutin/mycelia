import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PipelineDetailSection } from "./AudioPipelinePage";

describe("PipelineDetailSection", () => {
  it("keeps large pipeline details closed until requested and can close them again", () => {
    render(
      <PipelineDetailSection
        title="Parsed conversations"
        summary="178 conversations"
        icon={<span aria-hidden="true">C</span>}
        testId="conversation-section"
      >
        <div>Conversation detail row</div>
      </PipelineDetailSection>,
    );

    const trigger = screen.getByTestId("conversation-section");
    expect(trigger.getAttribute("data-state")).toBe("closed");
    expect(screen.queryByText("Conversation detail row")).toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("open");
    expect(screen.getByText("Conversation detail row")).not.toBeNull();

    fireEvent.click(trigger);
    expect(trigger.getAttribute("data-state")).toBe("closed");
    expect(screen.queryByText("Conversation detail row")).toBeNull();
  });
});
