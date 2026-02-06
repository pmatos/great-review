# Plan: Rewrite Promise.prototype.finally per spec 27.2.5.3

## Current Issues

The current `finally` implementation (lines 217-283 of promise.rs) has these problems:

1. **No species constructor lookup** — The spec requires `C = SpeciesConstructor(promise, %Promise%)` first, then the wrapper functions use `PromiseResolve(C, result)`. The current code skips this entirely.

2. **Uses `promise_resolve_value()` instead of `promise_resolve_with_constructor()`** — The wrapper functions call `interp.promise_resolve_value(&r)` which always uses the built-in Promise constructor. The spec requires using `C` from step 1.

3. **No `RequireInternalSlot` check** — The spec requires checking that `this` has `[[PromiseState]]` (i.e., is a promise) before anything else. Currently this check is only done inside `promise_then`.

4. **Doesn't use `Invoke(promise, "then", ...)` for the final call** — The spec says `Return ? Invoke(promise, "then", « thenFinally, catchFinally »)`. This should go through property lookup to support `.then()` overrides. Currently it calls `promise_then()` directly. We should look up and call "then" via property access instead.

## Spec Algorithm (27.2.5.3 Promise.prototype.finally)

```
1. Let promise be the this value.
2. If promise is not an Object, throw a TypeError exception.
3. Let C = ? SpeciesConstructor(promise, %Promise%).
4. Assert: IsConstructor(C) is true.
5. If IsCallable(onFinally) is false, then
   a. Let thenFinally be onFinally.
   b. Let catchFinally be onFinally.
6. Else,
   a. Let thenFinallyClosure be a new Abstract Closure with parameters (value) that captures C and onFinally and performs:
      i.   Let result be ? Call(onFinally, undefined).
      ii.  Let promise be ? PromiseResolve(C, result).
      iii. Let returnValue be a new Abstract Closure with parameters () that captures value:
           1. Return value.
      iv.  Let valueThunk be CreateBuiltinFunction(returnValue, 0, "", « »).
      v.   Return ? Invoke(promise, "then", « valueThunk »).
   b. Let thenFinally be CreateBuiltinFunction(thenFinallyClosure, 1, "", « »).
   c. Let catchFinallyClosure be a new Abstract Closure with parameters (reason) that captures C and onFinally and performs:
      i.   Let result be ? Call(onFinally, undefined).
      ii.  Let promise be ? PromiseResolve(C, result).
      iii. Let throwReason be a new Abstract Closure with parameters () that captures reason:
           1. Return ThrowCompletion(reason).
      iv.  Let thrower be CreateBuiltinFunction(throwReason, 0, "", « »).
      v.   Return ? Invoke(promise, "then", « thrower »).
   d. Let catchFinally be CreateBuiltinFunction(catchFinallyClosure, 1, "", « »).
7. Return ? Invoke(promise, "then", « thenFinally, catchFinally »).
```

## Proposed Changes

Rewrite the `finally` closure (lines 221-279) in `setup_promise()`:

1. **Add object check**: If `this` is not an Object, throw TypeError.
2. **Get species constructor**: `C = species_constructor(this, %Promise%)`.
3. **Non-callable path**: If `onFinally` is not callable, set both `thenFinally` and `catchFinally` to `onFinally` (pass-through).
4. **Callable path**: Create two wrapper closures that capture `C` and `onFinally`:
   - `thenFinally(value)`: Call `onFinally()`, then `promise_resolve_with_constructor(&C, &result)`, then look up "then" on the resulting promise and call it with a value-returning thunk.
   - `catchFinally(reason)`: Call `onFinally()`, then `promise_resolve_with_constructor(&C, &result)`, then look up "then" on the resulting promise and call it with a reason-throwing thunk.
5. **Final step**: Look up "then" on `this` via `get_object_property()` and call it with `[thenFinally, catchFinally]` — this is `Invoke(promise, "then", ...)`.

## Key Detail: Invoke vs direct call

The current code calls `interp.promise_then(this, ...)` directly. The spec says `Invoke(promise, "then", ...)`. `Invoke` performs a property lookup and calls the result. This matters because:
- A subclass might override `.then()`
- The test262 tests for `finally` check that `.then()` is called properly

So we need to: look up `promise["then"]` via `get_object_property()`, then `call_function()` with it.

Similarly, inside the wrapper functions, `Invoke(promise, "then", « valueThunk »)` should also go through property lookup on the PromiseResolve result.

## Files Modified

- `src/interpreter/builtins/promise.rs` — Only this file, rewriting lines 217-283.
