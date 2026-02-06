# eval-worker Plan: Fix super() spread, super in object literal methods, __proto__ in object literals

## Changes (all in `src/interpreter/eval.rs`)

### Fix 1: super() spread arguments (Task #3)

**Problem:** At line 2280-2286, the `super()` call evaluates arguments with a plain loop that does NOT handle `Expression::Spread`. When `super(...args)` is called, the spread expression is evaluated as a normal expression, which returns `JsValue::Undefined` (line 306).

**Fix:** Replace the manual arg evaluation loop at lines 2280-2286 with a call to the existing `eval_spread_args()` helper (line 5018), which correctly handles `Expression::Spread`.

Current code (lines 2280-2287):
```rust
let mut arg_vals = Vec::new();
for arg in args {
    match self.eval_expr(arg, env) {
        Completion::Normal(v) => arg_vals.push(v),
        other => return other,
    }
}
return self.call_function(&super_ctor, &this_val, &arg_vals);
```

New code:
```rust
let arg_vals = match self.eval_spread_args(args, env) {
    Ok(v) => v,
    Err(e) => return Completion::Throw(e),
};
return self.call_function(&super_ctor, &this_val, &arg_vals);
```

### Fix 2: super.prop in object literal methods (Task #3)

**Problem:** Object literal concise methods (`{ m() { return super.x; } }`) don't have `__home_object__` set in their environment. When `super.x` is evaluated, there is no HomeObject to look up the prototype chain.

**Approach:**
1. In `eval_object_literal` (line 6297), when a property value is a function (concise method, getter, or setter), we need to set a `__home_object__` binding in the function's closure environment pointing to the object literal being created.
2. However, the object isn't created until after all properties are evaluated. We need to create the object first (line 6390), then retroactively update the closures of any methods.

Actually, a better approach: We need to create the `JsObjectData` and its `Rc<RefCell<>>` first. Then, for methods, set `__home_object__` in the method's closure to point to the object. But we can't get the JsValue until we allocate_object_slot.

Revised approach: After the object is created and has an ID (line 6391-6392), iterate over all property values that are functions and update their closure envs to include `__home_object__` pointing to the new object.

Even simpler: For the function closures, they capture the environment at creation time. We need to add `__home_object__` to the method's closure env at function creation time. Since the object doesn't exist yet, we can create a placeholder and then update it.

Best approach: After the object is allocated (line 6391), iterate over all its callable properties and inject `__home_object__` into their closure environments. We'll scan each method function value and, if it's a User function, update its closure to include a `__home_object__` binding.

Actually, let me reconsider. The cleanest approach is:
1. Create the `Rc<RefCell<JsObjectData>>` first
2. Allocate its slot to get an ID and JsValue
3. For each property that's a method/getter/setter, create a method-specific environment that has `__home_object__` and use that as the closure
4. Then set up the properties

But this requires restructuring `eval_object_literal`. A simpler approach:

After the object is fully built and allocated (after line 6391), look at each method/getter/setter function stored in the object's properties. For each one that's a `JsFunction::User`, update its closure to bind `__home_object__`.

```rust
// After allocating the object, set __home_object__ for methods
let obj_val = JsValue::Object(crate::types::JsObject { id });
if let Some(obj_rc) = self.get_object(id) {
    let prop_values: Vec<JsValue> = {
        let b = obj_rc.borrow();
        b.properties.values().flat_map(|desc| {
            let mut vals = vec![];
            if let Some(ref v) = desc.value { vals.push(v.clone()); }
            if let Some(ref g) = desc.get { vals.push(g.clone()); }
            if let Some(ref s) = desc.set { vals.push(s.clone()); }
            vals
        }).collect()
    };
    for val in &prop_values {
        if let JsValue::Object(ref fo) = val
            && let Some(func_obj) = self.get_object(fo.id)
        {
            if let Some(JsFunction::User { ref closure, .. }) = func_obj.borrow().callable {
                closure.borrow_mut().declare("__home_object__", BindingKind::Const);
                let _ = closure.borrow_mut().set("__home_object__", obj_val.clone());
            }
        }
    }
}
```

3. Update `eval_member` (line 5700) and the `super.method()` path in `eval_call` (line 2361) to use `__home_object__` for super property lookups.

Currently for `super.method()` in `eval_call` (line 2362), the code gets `__super__` (the parent constructor), then looks up `prototype` on it. For object literal methods, there's no `__super__`.

The fix: When `super.x` or `super.method()` is encountered, check for `__home_object__` first. If found, look up the property on `Object.getPrototypeOf(homeObject)` (the internal `[[Prototype]]`). If not found, fall back to the current `__super__` behavior.

For `eval_member` (the non-call `super.x` case at line 5700-5751):
When `obj` is `Expression::Super`, evaluate it. Currently it returns `__super__` (the constructor). We need to change the super member access to use `__home_object__`:

```rust
// In eval_member, after getting obj_val from Expression::Super:
if matches!(obj, Expression::Super) {
    // Look up property on [[Prototype]] of HomeObject
    let home = env.borrow().get("__home_object__");
    if let Some(JsValue::Object(ref ho)) = home
        && let Some(home_obj) = self.get_object(ho.id)
    {
        if let Some(ref proto_rc) = home_obj.borrow().prototype.clone() {
            let proto_val = JsValue::Object(crate::types::JsObject { id: proto_rc.borrow().id.unwrap() });
            return self.get_object_property(proto_rc.borrow().id.unwrap(), &key, &proto_val);
        }
    }
    // Fall back to __super__.prototype for class-style super
    if let JsValue::Object(ref o) = obj_val {
        if let Some(obj) = self.get_object(o.id) {
            let proto_val = obj.borrow().get_property("prototype");
            if let JsValue::Object(ref p) = proto_val {
                return self.get_object_property(p.id, &key, &proto_val);
            }
        }
    }
    return Completion::Normal(JsValue::Undefined);
}
```

For `eval_call` super.method() (line 2361-2383), same approach:
```rust
if is_super_call {
    let home = env.borrow().get("__home_object__");
    if let Some(JsValue::Object(ref ho)) = home
        && let Some(home_obj) = self.get_object(ho.id)
    {
        if let Some(ref proto_rc) = home_obj.borrow().prototype.clone() {
            let method = proto_rc.borrow().get_property(&key);
            let this_val = env.borrow().get("this").unwrap_or(JsValue::Undefined);
            (method, this_val)
        } else {
            (JsValue::Undefined, JsValue::Undefined)
        }
    } else if let JsValue::Object(ref o) = obj_val {
        // existing code for class super.method()
    }
}
```

Also: For class methods, we should set `__home_object__` too! When class instance methods are created (line 6127-6138), their closure is `class_env`. After the method is installed on the prototype object, we should set `__home_object__` to the prototype object (for instance methods) or the constructor (for static methods).

### Fix 3: __proto__ in object literals (Task #4)

**Problem:** In `eval_object_literal`, when a property key is `__proto__` (not computed, not shorthand), the value is treated as a normal property. Per spec section 13.2.5.5, it should set the object's `[[Prototype]]` instead.

**Fix:** In the `PropertyKind::Init` branch of `eval_object_literal` (line 6384-6387), before `obj_data.insert_value(key, value)`, check if the key is `"__proto__"` and the property is not computed and not shorthand. If so, set `obj_data.prototype` instead.

```rust
// In the _ (Init) match arm at line 6384:
_ => {
    // __proto__: value sets [[Prototype]] per spec §13.2.5.5
    if key == "__proto__" && !prop.computed && !prop.shorthand {
        match &value {
            JsValue::Object(ref o) => {
                obj_data.prototype = self.get_object(o.id);
            }
            JsValue::Null => {
                obj_data.prototype = None;
            }
            _ => {
                // Non-object, non-null values are ignored per spec
            }
        }
    } else {
        self.set_function_name(&value, &key);
        obj_data.insert_value(key, value);
    }
}
```

## Summary of changes:
1. **Lines 2280-2287**: Replace manual arg loop with `eval_spread_args()` for super() calls
2. **Lines 2361-2383**: Update super.method() to check `__home_object__` first for prototype lookup
3. **Lines 5700-5751**: Update `eval_member` to handle `super.x` via `__home_object__`
4. **Lines 6127-6138 + 6140-6187**: After creating class methods, set `__home_object__` in their closure
5. **Lines 6384-6387**: Handle `__proto__` in object literal Init properties
6. **After line 6391**: Set `__home_object__` for object literal methods
