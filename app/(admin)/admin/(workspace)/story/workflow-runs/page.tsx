import { redirect } from "next/navigation";

export default function StoryWorkflowRunsPage() {
  // Workflow failure and manual retry are outside the current Story product scope.
  redirect("/admin/story/stories");
}
