
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration() {
        assert_eq!(parse_duration("7d"), Some(Duration::days(7)));
        assert_eq!(parse_duration("27d"), Some(Duration::days(27)));
        assert_eq!(parse_duration("1w"), Some(Duration::weeks(1)));
        assert_eq!(parse_duration("2m"), Some(Duration::days(60)));
        assert_eq!(parse_duration("1y"), Some(Duration::days(365)));
        assert_eq!(parse_duration("invalid"), None);
    }

    #[test]
    fn test_parse_query_upcoming() {
        let cq = CalendarQuery::parse("calendar:7d");
        match cq.time_range {
            TimeRange::Upcoming(d) => assert_eq!(d, Duration::days(7)),
            _ => panic!("Expected Upcoming(7d)"),
        }
        
        let cq2 = CalendarQuery::parse("calendar:27d");
        match cq2.time_range {
            TimeRange::Upcoming(d) => assert_eq!(d, Duration::days(27)),
            _ => panic!("Expected Upcoming(27d)"),
        }
    }

    #[test]
    fn test_parse_query_mixed() {
        let cq = CalendarQuery::parse("calendar:2w meeting with:john");
        match cq.time_range {
            TimeRange::Upcoming(d) => assert_eq!(d, Duration::weeks(2)),
            _ => panic!("Expected Upcoming(2w)"),
        }
        assert_eq!(cq.text, Some("meeting".to_string()));
        assert_eq!(cq.with, vec!["john".to_string()]);
    }

    #[test]
    fn test_get_time_range() {
        let cq = CalendarQuery::parse("calendar:7d");
        let (start, end) = cq.get_time_range();
        
        let now = Utc::now();
        let today = now.date_naive().and_hms_opt(0, 0, 0).unwrap().and_utc();
        
        // Start should be today (midnight UTC)
        assert_eq!(start, today);
        // End should be today + 7 days
        assert_eq!(end, today + Duration::days(7));
    }
}
