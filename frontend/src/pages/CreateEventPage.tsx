import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { callResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft } from "lucide-react";
import { ColorInput } from "@/components/forms/ColorInput";
import { CategoryInput } from "@/components/forms/CategoryInput";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { DateTimePicker } from "@/components/ui/datetime-picker";

const EVENT_CATEGORIES = [
  "geography",
  "life",
  "education",
  "relationship",
  "work",
  "misc",
];

const CreateEventPage = () => {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    title: "",
    shortTitle: "",
    description: "",
    kind: "point" as "point" | "range",
    category: "misc",
    color: "#64748b",
    start: new Date(),
    end: null as Date | null,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      const now = new Date();
      const doc = {
        action: "insertOne",
        collection: "events",
        doc: {
          kind: formData.kind,
          title: formData.title,
          shortTitle: formData.shortTitle || undefined,
          description: formData.description || undefined,
          color: formData.color,
          category: formData.category,
          start: formData.start,
          ...(formData.kind === "range" && formData.end
            ? { end: formData.end }
            : {}),
          createdAt: now,
          updatedAt: now,
        },
      } as const;

      await callResource("tech.mycelia.mongo", doc);
      navigate("/timeline");
    } catch (err) {
      console.error("Failed to create event:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to="/timeline">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Timeline
          </Button>
        </Link>
      </div>

      <h1 className="text-3xl font-bold">Create Event</h1>

      <form onSubmit={handleSubmit} className="border rounded-lg p-6 space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title *</Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) =>
                setFormData({ ...formData, title: e.target.value })}
              placeholder="Event title"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="shortTitle">Short Title</Label>
            <Input
              id="shortTitle"
              value={formData.shortTitle}
              onChange={(e) =>
                setFormData({ ...formData, shortTitle: e.target.value })}
              placeholder="Optional compact label"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })}
              placeholder="Optional details"
            />
          </div>

          <div className="space-y-2">
            <Label>Kind</Label>
            <ToggleGroup
              value={formData.kind}
              options={[
                { value: "point", label: "Point" },
                { value: "range", label: "Range" },
              ]}
              onChange={(value) =>
                setFormData({
                  ...formData,
                  kind: value,
                  end: value === "point" ? null : formData.end,
                })}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <CategoryInput
              id="category"
              value={formData.category}
              onChange={(e) =>
                setFormData({ ...formData, category: e.target.value })}
              categories={EVENT_CATEGORIES}
              placeholder="Event category"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="color">Color</Label>
            <ColorInput
              id="color"
              value={formData.color}
              onChange={(e) =>
                setFormData({ ...formData, color: e.target.value })}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="start">Start *</Label>
            <DateTimePicker
              value={formData.start}
              onChange={(date) =>
                date && setFormData({ ...formData, start: date })}
            />
          </div>

          {formData.kind === "range" && (
            <div className="space-y-2">
              <Label htmlFor="end">End</Label>
              <DateTimePicker
                value={formData.end}
                onChange={(date) => setFormData({ ...formData, end: date })}
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Link to="/timeline">
            <Button type="button" variant="outline" disabled={saving}>
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={saving}>
            {saving ? "Creating..." : "Create Event"}
          </Button>
        </div>
      </form>
    </div>
  );
};

export default CreateEventPage;
