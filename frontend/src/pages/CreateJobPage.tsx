import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import Form from "@rjsf/shadcn";
import validator from "@rjsf/validator-ajv8";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Play } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

export default function CreateJobPage() {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<string | null>(null);

  const { data: schemas, isLoading: isLoadingSchemas } = useQuery({
    queryKey: ["job-schemas"],
    queryFn: async () => {
      const response = await api.callResource("jobs", {
        action: "schemas",
      });
      return response as Record<string, any>;
    },
  });

  const enqueueMutation = useMutation({
    mutationFn: async (data: any) => {
      return await api.callResource("jobs", {
        action: "enqueue",
        data: {
          ...data,
          type: selectedType,
        },
        trigger: {
          type: "manual",
          reason: `Manual launch of ${selectedType} via Launch Job page`,
        },
      });
    },
    onSuccess: (response) => {
      toast.success(`Job enqueued successfully! ID: ${response.jobId}`);
      navigate("/jobs");
    },
    onError: (error) => {
      console.error("Failed to enqueue job:", error);
      toast.error("Failed to enqueue job");
    },
  });

  const handleTypeChange = (value: string) => {
    setSelectedType(value);
  };

  const onSubmit = (formData: any) => {
    enqueueMutation.mutate(formData);
  };

  const jobTypes = schemas ? Object.keys(schemas) : [];

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link to="/jobs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold tracking-tight">Launch New Job</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Job Type</CardTitle>
        </CardHeader>
        <CardContent>
          <Select onValueChange={handleTypeChange} value={selectedType || undefined}>
            <SelectTrigger className="w-[300px]">
              <SelectValue placeholder="Select a job type..." />
            </SelectTrigger>
            <SelectContent>
              {isLoadingSchemas ? (
                <SelectItem value="loading" disabled>Loading schemas...</SelectItem>
              ) : (
                jobTypes.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedType && schemas?.[selectedType] && (
        <Card>
          <CardHeader>
            <CardTitle className="capitalize">{selectedType} Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rjsf-container">
              <Form
                schema={schemas[selectedType]}
                validator={validator}
                onSubmit={(data: any) => onSubmit(data.formData)}
                disabled={enqueueMutation.isPending}
                noHtml5Validate={true}
                showErrorList={false}
                liveValidate={false}
              >
                <div className="mt-6">
                  <Button type="submit" disabled={enqueueMutation.isPending} className="w-full sm:w-auto">
                    {enqueueMutation.isPending ? (
                      "Launching..."
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-2" />
                        Launch Job
                      </>
                    )}
                  </Button>
                </div>
              </Form>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

