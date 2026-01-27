export function formatRelativeTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfToday.getDate() - 1);

  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  if (date >= startOfToday) {
    return `今天 ${timeFormatter.format(date)}`;
  }
  if (date >= startOfYesterday) {
    return `昨天 ${timeFormatter.format(date)}`;
  }
  const dateFormatter = new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
  return dateFormatter.format(date).replace("/", " 月 ").concat(" 日");
}

export function formatFullDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

export function formatContactStatus(hasContact: boolean) {
  return hasContact ? "有联系方式" : "待补联系方式";
}
