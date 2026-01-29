/**
 * API 响应类型定义
 * 
 * 所有API路由都应该遵循统一的响应格式
 */

// 标准成功响应
export type ApiResponse<T> = {
  data: T;
  error?: never;
};

// 标准错误响应
export type ApiErrorResponse = {
  data?: never;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
};

// 联合类型
export type ApiResult<T> = ApiResponse<T> | ApiErrorResponse;

// 类型守卫: 判断是否为错误响应
export function isApiError<T>(response: ApiResult<T>): response is ApiErrorResponse {
  return 'error' in response;
}

// 类型守卫: 判断是否为成功响应
export function isApiSuccess<T>(response: ApiResult<T>): response is ApiResponse<T> {
  return 'data' in response;
}

/**
 * 辅助函数: 从API响应中提取数据
 * 
 * @example
 * ```ts
 * const result = await createCustomerMutation.mutateAsync(data);
 * const customer = unwrapApiResult(result); // 自动推断类型为 Customer
 * if (customer) {
 *   console.log(customer.id); // 类型安全
 * }
 * ```
 */
export function unwrapApiResult<T>(response: ApiResult<T>): T | null {
  if (isApiSuccess(response)) {
    return response.data;
  }
  return null;
}

/**
 * 辅助函数: 创建标准API响应
 */
export function createApiResponse<T>(data: T): ApiResponse<T> {
  return { data };
}

export function createErrorResponse(message: string, code?: string): ApiErrorResponse {
  return { error: { message, code } };
}
