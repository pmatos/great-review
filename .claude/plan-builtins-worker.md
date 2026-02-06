# Builtins Worker Plan

## Files to edit
- `src/interpreter/builtins/mod.rs`
- `src/interpreter/types.rs`

## Task 4 (mod.rs part only): Object.prototype.__proto__ accessor

### Location
After `__lookupSetter__` setup (around line 2560), before `setup_function_prototype` call (line 2562).

### Changes
Add `__proto__` as an accessor property on `proto_obj` (Object.prototype):

**Getter** (`get __proto__`):
- If `this` is Object, return its prototype as JsValue (or null if no prototype)
- If `this` is not Object, return undefined

**Setter** (`set __proto__`):
- If `this` is not Object, return undefined (no-op for primitives)
- If value is Object, set `this.prototype = Some(value_rc)`
- If value is Null, set `this.prototype = None`
- Otherwise (primitive), do nothing (ignore)

Use `insert_property` with `PropertyDescriptor::accessor(Some(getter), Some(setter), false, true)` per spec (not enumerable, configurable).

## Task 5: Proxy improvements

### Analysis
After reviewing the code, `invoke_proxy_trap` (eval.rs:5352-5386) already handles revoked proxy checks for ALL traps. When `proxy_revoked == true`, it returns `Err(TypeError)`. All proxy operations in both eval.rs and mod.rs go through `invoke_proxy_trap`.

**Key findings:**
1. **Revoked checks**: Already working for all traps via `invoke_proxy_trap`. No changes needed in mod.rs.
2. **Proxy-of-Proxy forwarding**: When no trap is defined (`Ok(None)`), the code falls through to operate on the target. If target is itself a proxy, `get_object_property` (for get), the `in` operator (for has), etc. will recursively check proxy status. The `apply` trap at eval.rs:4740 calls `self.call_function(&target_val, ...)` which goes back through the proxy check. The `construct` trap at eval.rs:5106-5131 similarly forwards. So proxy-of-proxy should work for get/has/set/apply/construct already.
3. **Invariant validation**: defineProperty trap already validates (lines 2596-2633). The get trap validates (lines 5578-5607). The has trap validates (lines 76-92).

The main areas where Proxy improvements might help in mod.rs:
- Some `Ok(None)` fallthrough paths for Reflect methods may not properly recurse into proxy targets
- The `ownKeys` fallthrough might not handle proxy-of-proxy

Since most proxy functionality is in eval.rs (which I cannot edit), and the mod.rs proxy code already goes through `invoke_proxy_trap`, the improvements I can make are limited to:

1. **Reflect.ownKeys proxy-of-proxy fallthrough**: When no trap, if target is a proxy, forward to proxy's ownKeys instead of reading target's own keys directly
2. **Better invariant validation** for deleteProperty, set, and other traps in the Reflect implementations

### Changes for Reflect methods in mod.rs

**Reflect.ownKeys (around line 4821)**:
- In the `Ok(None)` branch, when target is itself a proxy, recursively invoke ownKeys via `invoke_proxy_trap` instead of reading properties directly.

**Reflect.getOwnPropertyDescriptor (around line 4586)**:
- In the `Ok(None)` branch, if target is proxy, recurse through proxy trap.

**Object.getOwnPropertyDescriptor (around line 2693)**:
- Same fix: when no trap and target is proxy, recurse.

## Task 6: Object.defineProperty fixes

### 6.1: ToString key coercion (line 2576 of mod.rs)

**Current code:**
```rust
let key = args.get(1).map(to_property_key_string).unwrap_or_default();
```

**Problem:** `to_property_key_string` calls `format!("{val}")` which for objects just produces `"[object Object]"` instead of calling `toString()`/`valueOf()`.

**Fix:** Replace with proper ToPropertyKey that uses the interpreter's `to_string_value` for objects:
```rust
let key_raw = args.get(1).cloned().unwrap_or(JsValue::Undefined);
let key = if matches!(key_raw, JsValue::Symbol(_)) {
    to_property_key_string(&key_raw)
} else {
    match interp.to_string_value(&key_raw) {
        Ok(s) => s,
        Err(e) => return Completion::Throw(e),
    }
};
```

Also apply to Reflect.defineProperty (line 4420) and Object.getOwnPropertyDescriptor (line 2689) and other methods that use `to_property_key_string` on the second arg.

### 6.2: ArraySetLength (in types.rs `define_own_property`)

**Location:** `define_own_property` in types.rs (line 735)

**Current behavior:** When `Object.defineProperty(arr, "length", {value: n})` is called on an array, it's treated as a normal property update. No truncation or validation.

**Fix:** At the beginning of `define_own_property`, check if:
1. `self.class_name == "Array"` AND `key == "length"`
2. If so, implement ArraySetLength:
   - If desc has a value, coerce via ToUint32
   - If ToNumber(value) != ToUint32(value), the caller should throw RangeError (but since define_own_property returns bool, we need to signal this differently - possibly with a separate method or enum return)

Actually, since `define_own_property` returns `bool` and can't throw, the ArraySetLength algorithm needs to be implemented at the call site in mod.rs's `Object.defineProperty` implementation.

**Revised approach:** In mod.rs `Object.defineProperty` (line 2659-2665), before calling `define_own_property`:
1. Check if target is array (`class_name == "Array"`) and key is `"length"`
2. If so, implement ArraySetLength:
   - Extract value from descriptor
   - Coerce to number, check if ToUint32 == ToNumber, else throw RangeError
   - Get old length
   - If newLen < oldLen, delete elements from newLen to oldLen-1
   - Update array_elements
   - Then proceed with normal define_own_property for the length property

### 6.3: Error prototype chain (mod.rs)

**Problem:** Error is registered at lines 87-139, before `object_prototype` is set (line 2276). So Error.prototype created by `create_function` has `prototype = None` (since `self.object_prototype` is `None` at that time).

**Fix:** After `self.object_prototype` is set (after line 2276 in `setup_object_statics`), find Error.prototype and all error subtype prototypes and set their `[[Prototype]]` to `object_prototype`.

Add a block after line 2276 that:
1. Gets Error from global env
2. Gets Error.prototype
3. Sets `Error.prototype.[[Prototype]] = object_prototype`
4. For each error subtype (TypeError, RangeError, etc.), their prototypes inherit from Error.prototype which should already be correct since the subtypes' prototypes are created after Error with `prototype = Some(ep.clone())`.

Actually, the subtype prototypes at line 304 do `native_proto = self.create_object()` which also has `prototype = None` at that point (still before object_prototype is set). Then at line 305-306, they set `native_proto.prototype = Some(ep.clone())` where ep is Error.prototype. So the chain is: `TypeError.prototype -> Error.prototype -> null` instead of `TypeError.prototype -> Error.prototype -> Object.prototype`.

**Fix location:** After line 2276 where `self.object_prototype` is set. Add code to retroactively fix Error.prototype's [[Prototype]]:
```rust
// Fix Error.prototype chain - it was created before object_prototype was available
if let Some(ref op) = self.object_prototype {
    let env = self.global_env.borrow();
    if let Some(error_val) = env.get("Error") {
        if let JsValue::Object(o) = &error_val {
            if let Some(ctor) = self.get_object(o.id) {
                let proto_val = ctor.borrow().get_property("prototype");
                if let JsValue::Object(p) = &proto_val {
                    if let Some(ep) = self.get_object(p.id) {
                        if ep.borrow().prototype.is_none() {
                            ep.borrow_mut().prototype = Some(op.clone());
                        }
                    }
                }
            }
        }
    }
}
```

## Implementation Order

1. **Task 6.3** - Error prototype chain fix (simplest, smallest diff)
2. **Task 6.1** - ODP key coercion
3. **Task 6.2** - ArraySetLength
4. **Task 4** - Object.prototype.__proto__ accessor
5. **Task 5** - Proxy improvements (Reflect method proxy-of-proxy forwarding)
