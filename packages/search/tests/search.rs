#[cfg(test)]
mod search {
    use wasm_bindgen::JsValue;
    use wasm_bindgen_test::*;

    wasm_bindgen_test_configure!(run_in_browser);

    #[wasm_bindgen_test]
    pub fn test_search_bytes() {
        let text = "One Wiseman came to Jhaampe-town. \
                    He set aside both Queen and Crown \
                    Did his task and fell asleep \
                    Gave his bones to the stones to keep.";

        let bytes = text.as_bytes();

        let result = search::search_bytes(bytes, "set aside");

        assert_eq!(result, JsValue::from_bool(true));
    }
}
