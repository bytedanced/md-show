use std::collections::HashMap;
use std::sync::Arc;

use http::{HeaderName, HeaderValue};
use rmcp::model::CallToolRequestParams;
use rmcp::service::{RoleClient, RunningService};
use rmcp::transport::child_process::TokioChildProcess;
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::StreamableHttpClientTransport;
use rmcp::ServiceExt;
use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;
use tokio::sync::Mutex;

struct ServerEntry {
    client: Arc<RunningService<RoleClient, ()>>,
    #[allow(dead_code)]
    headers: Option<HashMap<String, String>>,
}

pub struct McpState {
    connections: Mutex<HashMap<String, ServerEntry>>,
}

impl McpState {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Serialize)]
pub struct McpToolInfo {
    pub server_id: String,
    pub name: String,
    pub description: String,
    pub input_schema: Value,
}

#[derive(Serialize)]
pub struct McpServerHealth {
    pub server_id: String,
    pub healthy: bool,
    pub tool_count: usize,
}

#[derive(Serialize)]
pub struct McpCallResult {
    pub is_error: bool,
    pub text: String,
}

#[tauri::command]
pub async fn mcp_connect(
    state: tauri::State<'_, McpState>,
    server_id: String,
    transport: String,
    url: Option<String>,
    headers: Option<HashMap<String, String>>,
    command: Option<String>,
    args: Option<Vec<String>>,
    _timeout_ms: Option<u64>,
) -> Result<(), String> {
    let headers_clone = headers.clone();
    let client: Arc<RunningService<RoleClient, ()>> = match transport.as_str() {
        "http" | "streamable-http" => {
            let endpoint = url.ok_or_else(|| "HTTP 传输需要提供 URL".to_string())?;
            let mut config = StreamableHttpClientTransportConfig::with_uri(endpoint);
            let mut header_map: HashMap<HeaderName, HeaderValue> = HashMap::new();
            let mut req_header_map = reqwest::header::HeaderMap::new();
            if let Some(ref h) = headers {
                for (k, v) in h {
                    let name = HeaderName::from_bytes(k.as_bytes())
                        .map_err(|e| format!("无效的请求头名称：{}", e))?;
                    let value = HeaderValue::from_str(v)
                        .map_err(|e| format!("无效的请求头值：{}", e))?;
                    req_header_map.insert(name.clone(), value.clone());
                    header_map.insert(name, value);
                }
            }
            if !header_map.is_empty() {
                config = config.custom_headers(header_map);
            }
            let http_client = if !req_header_map.is_empty() {
                reqwest::Client::builder()
                    .default_headers(req_header_map)
                    .build()
                    .map_err(|e| format!("创建 HTTP 客户端失败：{}", e))?
            } else {
                reqwest::Client::new()
            };
            let t = StreamableHttpClientTransport::with_client(http_client, config);
            Arc::new(
                ().serve(t)
                    .await
                    .map_err(|e| format!("连接 MCP 服务器失败：{}", e))?,
            )
        }
        "stdio" => {
            let cmd = command.ok_or_else(|| "stdio 传输需要提供 command".to_string())?;
            let cmd_args = args.unwrap_or_default();
            let mut command = Command::new(&cmd);
            command.args(&cmd_args);
            let t = TokioChildProcess::new(command)
                .map_err(|e| format!("创建 stdio 传输失败：{}", e))?;
            Arc::new(
                ().serve(t)
                    .await
                    .map_err(|e| format!("连接 MCP 服务器失败：{}", e))?,
            )
        }
        other => return Err(format!("不支持的传输类型：{}", other)),
    };

    let mut connections = state.connections.lock().await;
    if let Some(old) = connections.remove(&server_id) {
        if let Ok(svc) = Arc::try_unwrap(old.client) {
            let _ = svc.cancel().await;
        }
    }
    connections.insert(server_id, ServerEntry { client, headers: headers_clone });
    Ok(())
}

#[tauri::command]
pub async fn mcp_disconnect(
    state: tauri::State<'_, McpState>,
    server_id: String,
) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    if let Some(entry) = connections.remove(&server_id) {
        if let Ok(svc) = Arc::try_unwrap(entry.client) {
            let _ = svc.cancel().await;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn mcp_list_all_tools(
    state: tauri::State<'_, McpState>,
) -> Result<Vec<McpToolInfo>, String> {
    let connections = state.connections.lock().await;
    let mut result = Vec::new();
    for (server_id, entry) in connections.iter() {
        let tools_result = entry
            .client
            .list_all_tools()
            .await
            .map_err(|e| format!("{}", e))?;
        for tool in tools_result {
            let schema_value = serde_json::to_value(&*tool.input_schema).unwrap_or(Value::Null);
            result.push(McpToolInfo {
                server_id: server_id.clone(),
                name: tool.name.to_string(),
                description: tool.description.as_deref().unwrap_or("").to_string(),
                input_schema: schema_value,
            });
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn mcp_call_tool(
    state: tauri::State<'_, McpState>,
    server_id: String,
    tool_name: String,
    arguments: Value,
) -> Result<McpCallResult, String> {
    let client = {
        let connections = state.connections.lock().await;
        connections
            .get(&server_id)
            .map(|e| Arc::clone(&e.client))
            .ok_or_else(|| format!("服务器未连接：{}", server_id))?
    };

    let args_map = match arguments {
        Value::Object(map) => Some(map),
        Value::Null => None,
        _ => return Err("arguments 必须是对象".to_string()),
    };

    let params = CallToolRequestParams {
        meta: None,
        name: tool_name.into(),
        arguments: args_map,
        task: None,
    };

    let result = client
        .call_tool(params)
        .await
        .map_err(|e| format!("{}", e))?;

    let text = result
        .content
        .iter()
        .filter_map(|c| c.as_text().map(|t| t.text.clone()))
        .collect::<Vec<_>>()
        .join("\n");

    Ok(McpCallResult {
        is_error: result.is_error.unwrap_or(false),
        text,
    })
}

#[tauri::command]
pub async fn mcp_health_check(
    state: tauri::State<'_, McpState>,
) -> Result<Vec<McpServerHealth>, String> {
    let connections = state.connections.lock().await;
    let mut result = Vec::new();
    for (server_id, entry) in connections.iter() {
        let healthy = !entry.client.is_closed();
        let tool_count = match entry.client.list_all_tools().await {
            Ok(r) => r.len(),
            Err(_) => 0,
        };
        result.push(McpServerHealth {
            server_id: server_id.clone(),
            healthy,
            tool_count,
        });
    }
    Ok(result)
}

#[tauri::command]
pub async fn mcp_shutdown_all(state: tauri::State<'_, McpState>) -> Result<(), String> {
    let mut connections = state.connections.lock().await;
    for (_, entry) in connections.drain() {
        if let Ok(svc) = Arc::try_unwrap(entry.client) {
            let _ = svc.cancel().await;
        }
    }
    Ok(())
}
