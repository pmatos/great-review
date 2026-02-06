# Plan: Implement Promise Subclass Support (NewPromiseCapability) - Task #6

## Problem

Currently, `Promise.all`, `Promise.allSettled`, `Promise.race`, `Promise.any`, `Promise.resolve`, `Promise.reject`, `Promise.withResolvers`, `Promise.try`, and `promise_then` all create plain `Promise` objects via `self.create_promise_object()`. The spec requires these methods to use `NewPromiseCapability(C)` where `C` is either:
- The `this` value (for static methods like `Promise.all.call(SubPromise, ...)`)
- The result of `SpeciesConstructor(promise, %Promise%)` (for `promise_then`)

This means subclassing doesn't work: `SubPromise.all(...)` returns a plain Promise instead of a SubPromise.

## Changes (all in `src/interpreter/builtins/promise.rs`)

### Step 1: Add `construct` helper to `eval.rs`

Add a `pub(crate) fn construct(&mut self, constructor: &JsValue, args: &[JsValue]) -> Completion` method that programmatically does `new constructor(...args)`. This extracts the key logic from `eval_new`:
1. Verify constructor is callable+constructable
2. Handle Proxy construct trap
3. Create new object, set prototype from constructor.prototype
4. Set `new_target`, call constructor function, restore `new_target`
5. Return object result (or `this` if constructor didn't return an object)

### Step 2: Add `new_promise_capability` helper in `promise.rs`

Implement `NewPromiseCapability(C)` per spec section 27.2.1.5:
1. If C is not a constructor, throw TypeError
2. Create a `GetCapabilitiesExecutor` function that captures resolve/reject slots
3. Call `new C(executor)` using the `construct` helper
4. Verify that resolve and reject are both callable
5. Return `(promise, resolve_fn, reject_fn)` tuple

The executor function:
- First call with (undefined/no-args): sets resolve=undefined, reject=undefined (no error)
- First call with (resolve, reject): stores them
- Second call: if resolve or reject are already non-undefined, throw TypeError

### Step 3: Add `species_constructor` helper in `promise.rs`

Implement `SpeciesConstructor(O, defaultConstructor)`:
1. Get O.constructor
2. If undefined, return defaultConstructor
3. If not an object, throw TypeError
4. Get constructor[Symbol.species] (key: `"Symbol(Symbol.species)"`)
5. If undefined or null, return defaultConstructor
6. If result is a constructor, return it
7. Otherwise throw TypeError

### Step 4: Update `promise_then` to use SpeciesConstructor + NewPromiseCapability

Currently creates derived promise directly. Change to:
1. Get `C = SpeciesConstructor(promise, %Promise%)`
2. Get `(derived, resolve, reject) = NewPromiseCapability(C)`
3. Use those resolve/reject in the reactions instead of `create_resolving_functions`

### Step 5: Update static methods to accept and use `this` as constructor

Update the following methods to pass `_this` through to `new_promise_capability`:

- **Promise.resolve**: Use `NewPromiseCapability(_this)` instead of `create_promise_object`. Also check if value is a promise and its constructor matches `this` (return early per spec step 3).
- **Promise.reject**: Use `NewPromiseCapability(_this)` instead of `create_promise_object`.
- **Promise.all**: Use `NewPromiseCapability(_this)` for the result promise, and get `C.resolve` to resolve individual items.
- **Promise.allSettled**: Same pattern as `Promise.all`.
- **Promise.race**: Same pattern.
- **Promise.any**: Same pattern.
- **Promise.withResolvers**: Use `NewPromiseCapability(_this)`.
- **Promise.try**: Use `NewPromiseCapability(_this)`.

For `Promise.all/allSettled/race/any`, the spec also requires:
- Step 1: Get `promiseResolve = Get(C, "resolve")`
- Step 2: If `IsCallable(promiseResolve)` is false, throw TypeError
- Then use `Call(promiseResolve, C, [item])` instead of `self.promise_resolve_value()` to resolve each item

### Step 6: Update internal helper signatures

The methods `promise_all`, `promise_all_settled`, `promise_race`, `promise_any` need to accept the constructor `this` value as a parameter.

## Files Modified
- `src/interpreter/builtins/promise.rs` - All promise changes
- `src/interpreter/eval.rs` - Add `construct` helper

## Expected Test Impact
~100-150 new test262 passes in `test262/test/built-ins/Promise/`
