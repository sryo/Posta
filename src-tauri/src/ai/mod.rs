// Gemini API client for smart replies
use serde::Deserialize;
use serde_json::json;

const API_ENDPOINT: &str = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

pub struct GeminiClient {
    client: reqwest::Client,
    api_key: String,
    endpoint: String,
}

#[derive(Debug, Deserialize)]
struct GenerationResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    content: Option<Content>,
    finish_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Option<Vec<Part>>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
    #[serde(default)]
    thought: bool,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        // Without a timeout a hung Gemini request blocks suggest_replies forever
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new());
        Self {
            client,
            api_key,
            endpoint: API_ENDPOINT.to_string(),
        }
    }

    pub async fn suggest_replies(&self, email_context: &str, user_email: &str) -> Result<Vec<String>, String> {
        let prompt = format!(
            r#"You are an email assistant for {user_email}.

Analyze this email thread and generate 3 contextually appropriate reply suggestions.

Guidelines:
- Match the tone of the conversation (formal for business, casual for personal)
- If it's a scheduling request: suggest accepting, declining, or proposing alternatives
- If it's a question: provide a substantive answer or acknowledge you'll look into it
- If it's a request/task: acknowledge and indicate action or timeline
- If it's informational: thank them or acknowledge receipt appropriately
- Use first person ("I'll", "I can", "Thanks for")
- Reference specific details from the email when relevant
- Keep replies 1-2 sentences, ready to send as-is
- Don't be generic - tailor each reply to the actual content

Email Thread:
{context}

Return ONLY a raw JSON array of 3 strings. No markdown, no explanation.
Example format: ["Reply 1", "Reply 2", "Reply 3"]"#,
            user_email = user_email,
            context = email_context
        );

        // The key goes in a header: reqwest errors echo the request URL
        let resp = self
            .client
            .post(&self.endpoint)
            .header("x-goog-api-key", &self.api_key)
            .json(&request_body(&prompt))
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e.without_url()))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(api_error(status, &text));
        }

        let response: GenerationResponse = resp
            .json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e.without_url()))?;

        parse_json_list(&response_text(response)?)
    }
}

/// Google's error body is JSON with a readable `error.message`; anything
/// else is passed through as is
fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let message = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v["error"]["message"].as_str().map(str::to_string))
        .unwrap_or_else(|| body.trim().to_string());
    format!("Gemini API error {}: {}", status, message)
}

fn request_body(prompt: &str) -> serde_json::Value {
    json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.4,
            "maxOutputTokens": 512,
            "responseMimeType": "application/json",
            // 2.5 Flash thinks by default and those tokens count against
            // maxOutputTokens, which can leave no room for the answer
            "thinkingConfig": { "thinkingBudget": 0 },
        }
    })
}

fn response_text(response: GenerationResponse) -> Result<String, String> {
    let candidate = response
        .candidates
        .and_then(|c| c.into_iter().next())
        .ok_or("No valid response content from AI")?;

    let text: String = candidate
        .content
        .and_then(|c| c.parts)
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !p.thought)
        .filter_map(|p| p.text)
        .collect();

    if text.trim().is_empty() {
        return Err(match candidate.finish_reason {
            Some(reason) => format!("No valid response content from AI (finish reason: {})", reason),
            None => "No valid response content from AI".to_string(),
        });
    }
    Ok(text)
}

fn parse_json_list(text: &str) -> Result<Vec<String>, String> {
    let array = match (text.find('['), text.rfind(']')) {
        (Some(start), Some(end)) if start < end => &text[start..=end],
        _ => text.trim(),
    };

    let suggestions: Vec<String> = serde_json::from_str::<Vec<String>>(array)
        .map_err(|e| format!("Failed to parse JSON suggestions: {} (Text: {})", e, text.trim()))?
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    if suggestions.is_empty() {
        return Err("AI returned no suggestions".to_string());
    }
    Ok(suggestions)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn client_at(endpoint: &str) -> GeminiClient {
        GeminiClient {
            client: reqwest::Client::new(),
            api_key: "SECRET-KEY-123".into(),
            endpoint: endpoint.into(),
        }
    }

    #[tokio::test]
    async fn transport_errors_do_not_leak_api_key() {
        let err = client_at("http://127.0.0.1:1/generate")
            .suggest_replies("ctx", "me@x.com")
            .await
            .unwrap_err();
        assert!(err.starts_with("Request failed"), "{}", err);
        assert!(!err.contains("SECRET-KEY-123"), "{}", err);
    }

    #[test]
    fn api_error_reports_googles_message_not_the_raw_body() {
        let body = r#"{
  "error": {
    "code": 400,
    "message": "API key not valid. Please pass a valid API key.",
    "status": "INVALID_ARGUMENT",
    "details": [{"@type": "type.googleapis.com/google.rpc.ErrorInfo", "reason": "API_KEY_INVALID"}]
  }
}"#;
        let err = api_error(reqwest::StatusCode::BAD_REQUEST, body);
        assert_eq!(err, "Gemini API error 400 Bad Request: API key not valid. Please pass a valid API key.");
    }

    #[test]
    fn api_error_without_json_keeps_the_body() {
        let err = api_error(reqwest::StatusCode::BAD_GATEWAY, "upstream down");
        assert_eq!(err, "Gemini API error 502 Bad Gateway: upstream down");
    }

    #[test]
    fn parses_plain_and_fenced_arrays() {
        assert_eq!(parse_json_list(r#"["a","b","c"]"#).unwrap(), ["a", "b", "c"]);
        assert_eq!(
            parse_json_list("```json\n[\"a\", \"b\"]\n```").unwrap(),
            ["a", "b"]
        );
    }

    #[test]
    fn parses_array_surrounded_by_prose() {
        assert_eq!(
            parse_json_list("Here are some replies:\n[\"Sure, works for me.\", \"Can we do [Tuesday]?\"]\nHope that helps").unwrap(),
            ["Sure, works for me.", "Can we do [Tuesday]?"]
        );
    }

    #[test]
    fn drops_blank_suggestions() {
        assert_eq!(parse_json_list(r#"["  ok  ", "", "   "]"#).unwrap(), ["ok"]);
        assert!(parse_json_list(r#"["", " "]"#).is_err());
        assert!(parse_json_list("no json here").is_err());
    }

    #[test]
    fn response_text_joins_parts_and_skips_thoughts() {
        let resp: GenerationResponse = serde_json::from_str(
            r#"{"candidates":[{"content":{"parts":[
                {"text":"thinking...","thought":true},
                {"text":"[\"a\","},
                {"text":"\"b\"]"}
            ]}}]}"#,
        )
        .unwrap();
        assert_eq!(response_text(resp).unwrap(), r#"["a","b"]"#);
    }

    #[test]
    fn response_without_text_reports_finish_reason() {
        let resp: GenerationResponse = serde_json::from_str(
            r#"{"candidates":[{"content":{"role":"model"},"finishReason":"MAX_TOKENS"}]}"#,
        )
        .unwrap();
        let err = response_text(resp).unwrap_err();
        assert!(err.contains("MAX_TOKENS"), "{}", err);

        let empty: GenerationResponse = serde_json::from_str(r#"{}"#).unwrap();
        assert!(response_text(empty).is_err());
    }

    #[test]
    fn request_disables_thinking_and_asks_for_json() {
        let body = request_body("prompt");
        let config = &body["generationConfig"];
        assert_eq!(config["thinkingConfig"]["thinkingBudget"], 0);
        assert_eq!(config["responseMimeType"], "application/json");
        assert_eq!(body["contents"][0]["parts"][0]["text"], "prompt");
    }
}
