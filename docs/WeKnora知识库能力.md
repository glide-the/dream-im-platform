WeKnora 知识库能力相关的按功能分为以下几类：

| **分类** | **描述** | **文档链接** |
| --- | --- | --- |
| **租户管理** | **创建和管理租户账户** | [**tenant.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/tenant.md) |
| **知识库管理** | **创建、查询和管理知识库** | [**knowledge-base.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge-base.md) |
| **知识管理** | **上传、检索和管理知识内容** | [**knowledge.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge.md) |
| **分块管理** | **管理知识的分块内容** | [**chunk.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/chunk.md) |
| **标签管理** | **管理知识库的标签分类** | [**tag.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/tag.md) |
| **FAQ管理** | **管理FAQ问答对** | [**faq.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/faq.md) |
| **知识搜索** | **在知识库中搜索内容** | [**knowledge-search.md**](https://github.com/Tencent/WeKnora/blob/main/docs/api/knowledge-search.md) |

### **概述**

WeKnora 提供了一系列 RESTful API，用于创建和管理知识库、检索知识，以及进行基于知识的问答。本文档详细描述了这些 API 的使用方式。

### **基础信息**

- **基础 URL**: `/api/v1`
- **响应格式**: JSON
- **认证方式**: API Key

### **认证机制**

所有 API 请求需要在 HTTP 请求头中包含 `X-API-Key` 进行身份认证：

```
X-API-Key: your_api_key
```

为便于问题追踪和调试，建议每个请求的 HTTP 请求头中添加 `X-Request-ID`：

```
X-Request-ID: unique_request_id
```

### **获取 API Key**

在 web 页面完成账户注册后，请前往账户信息页面获取您的 API Key。

请妥善保管您的 API Key，避免泄露。API Key 代表您的账户身份，拥有完整的 API 访问权限。

### **错误处理**

所有 API 使用标准的 HTTP 状态码表示请求状态，并返回统一的错误响应格式：

```json
{
  "success": false,
  "error": {
    "code": "错误代码",
    "message": "错误信息",
    "details": "错误详情"
  }
}
```