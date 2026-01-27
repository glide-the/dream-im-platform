export async function apiRequest<T>(
  url: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = (await response.json().catch(() => ({}))) as
    | { error?: string }
    | T;

  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? (data as { error?: string }).error
        : "请求失败";
    throw new Error(message || "请求失败");
  }

  return data as T;
}
