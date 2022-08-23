#[cfg(test)]
mod search {
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    pub fn test_search_bytes() {
        let text = "One Wiseman came to Jhaampe-town.\n
He set aside both Queen and Crown\n
Did his task and fell asleep\n
Gave his bones to the stones to keep.";

        let bytes = text.as_bytes();

        let result = search::search_bytes(bytes, "set aside");

        assert_eq!(result.count, 1);

        assert_eq!(result.lines.at(0), "He set aside both Queen and Crown\n");
    }
}
