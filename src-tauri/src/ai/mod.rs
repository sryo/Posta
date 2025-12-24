use serde::Deserialize;
use serde_json::json;

const API_ENDPOINT_TEMPLATE: &str = "https://us-central1-aiplatform.googleapis.com/v1/projects/{PROJECT_ID}/locations/us-central1/publishers/google/models/gemini-1.5-flash:generateContent";

pub struct VertexAiClient {
    client: reqwest::Client,
    access_token: String,
    project_id: String,
}

#[derive(Debug, Deserialize)]
struct GenerationResponse {
    candidates: Option<Vec<Candidate>>,
}

#[derive(Debug, Deserialize)]
struct Candidate {
    content: Option<Content>,
}

#[derive(Debug, Deserialize)]
struct Content {
    parts: Option<Vec<Part>>,
}

#[derive(Debug, Deserialize)]
struct Part {
    text: Option<String>,
}

impl VertexAiClient {
    pub fn new(access_token: String, project_id: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            access_token,
            project_id,
        }
    }

    pub async fn suggest_replies(&self, email_context: &str) -> Result<Vec<String>, String> {
        let url = API_ENDPOINT_TEMPLATE.replace("{PROJECT_ID}", &self.project_id);

        let prompt = format!(
            "You are a helpful email assistant. Based on the following email thread, suggest 3 short, professional, and concise replies. \
            Return ONLY a raw JSON array of strings, e.g., [\"Yes, that works.\", \"I'll review it.\", \"Can we reschedule?\"]. \
            Do not include markdown formatting (like ```json). \
            \
            Email Context: \
            {}",
            email_context
        );

        let body = json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": prompt }]
            }],
            "generationConfig": {
                "temperature": 0.2,
                "maxOutputTokens": 256,
            }
        });

        let resp = self.client
            .post(&url)
            .bearer_auth(&self.access_token)
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("Request failed: {}", e))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Vertex AI API error {}: {}", status, text));
        }

        let response: GenerationResponse = resp.json()
            .await
            .map_err(|e| format!("Failed to parse response: {}", e))?;

        // Extract text
        if let Some(candidates) = response.candidates {
            if let Some(first) = candidates.first() {
                if let Some(content) = &first.content {
                    if let Some(parts) = &content.parts {
                        if let Some(first_part) = parts.first() {
                            if let Some(text) = &first_part.text {
                                return self.parse_json_list(text);
                            }
                        }
                    }
                }
            }
        }

        Err("No valid response content from AI".to_string())
    }

    fn parse_json_list(&self, text: &str) -> Result<Vec<String>, String> {
        // Clean up text (remove markdown codes if present)
        let clean_text = text.trim()
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        serde_json::from_str::<Vec<String>>(clean_text)
            .map_err(|e| format!("Failed to parse JSON suggestions: {} (Text: {})", e, clean_text))
    }
}
