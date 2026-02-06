# Plan: Implement Symbol.isConcatSpreadable in Array.prototype.concat

## File: `src/interpreter/builtins/array.rs` (lines 497-534)

## Changes

### 1. Replace the spreadability check in concat (lines 508-513)

Current code:
```rust
let spreadable = if let Some(obj) = get_obj(interp, item) {
    obj.borrow().array_elements.is_some()
} else {
    false
};
```

Replace with IsConcatSpreadable per spec section 23.1.3.1.1:

```rust
// IsConcatSpreadable(E)
let spreadable = if let JsValue::Object(obj_ref) = item {
    // Step 2: Get(E, @@isConcatSpreadable)
    let sym_key = interp.get_symbol_key("isConcatSpreadable");
    let spreadable_val = if let Some(key) = &sym_key {
        match interp.get_object_property(obj_ref.id, key, item) {
            Completion::Normal(v) => v,
            Completion::Throw(e) => return Completion::Throw(e),
            other => return other,
        }
    } else {
        JsValue::Undefined
    };
    // Step 3-4: If not undefined, ToBoolean; else IsArray
    if !matches!(spreadable_val, JsValue::Undefined) {
        to_boolean(&spreadable_val)
    } else {
        // Fall back to IsArray check
        if let Some(obj) = interp.get_object(obj_ref.id) {
            obj.borrow().array_elements.is_some()
        } else {
            false
        }
    }
} else {
    false  // Non-objects are never spreadable
};
```

### 2. Improve error propagation in the spread loop

Current code uses `unwrap_or(0)` for length and swallows errors in `obj_get`. Change:
- `length_of_array_like(interp, item).unwrap_or(0)` -> propagate the error
- Use `get_object_property` for element access to propagate getter errors

### 3. No new helper functions needed

The `get_symbol_key` method already exists on `Interpreter` (defined in `regexp.rs`). The `to_boolean` helper exists in `helpers.rs`. We use `get_object_property` for getter-aware property access.

## Tests to validate
```
uv run python scripts/run-test262.py test262/test/built-ins/Array/prototype/concat/
```

## Expected new passes
- `is-concat-spreadable-val-falsey.js` - arrays with falsey isConcatSpreadable are not spread
- `is-concat-spreadable-val-truthy.js` - objects with truthy isConcatSpreadable are spread
- `is-concat-spreadable-val-undefined.js` - undefined falls back to IsArray
- `is-concat-spreadable-get-err.js` - getter errors propagate
- `spreadable-boolean-wrapper.js` - Boolean wrappers with isConcatSpreadable
- `spreadable-function.js` - Functions with isConcatSpreadable
- `spreadable-number-wrapper.js` - Number wrappers
- `spreadable-reg-exp.js` - RegExp objects
- `spreadable-sparse-object.js` - Sparse object spreading
- `spreadable-string-wrapper.js` - String wrappers
- `spreadable-getter-throws.js` - Getter that throws during isConcatSpreadable access
- Various proxy-related tests
