# LC (Load Calculator) Update Failed - Solution Guide

## Issue Summary
When updating room inputs in Load Calculator:
- ✗ Toast shows "Update failed"
- ✗ UI stuck on "Saving" state
- ✗ Data not persisting to Firestore

## Root Causes Identified & Fixed

### ✅ Issue #1: Missing Error Handling (FIXED)
**Status:** Resolved in code

The `persistRoomAnalysisSnapshot()` function had no try-catch block. When Firestore updates failed:
- Error was silently swallowed
- UI state remained "saving" forever
- User had no feedback

**Fix Applied:**
- Added try-catch around persistRoomAnalysisSnapshot
- Added error logging to console
- Reset save state to 'idle' on failure
- Display actual error message in toast

Files Modified:
- `src/components/hvac/LoadCalculator.tsx`
  - Line ~460: Added try-catch to persistRoomAnalysisSnapshot
  - Line ~1710: Better error handling in updateRoom

### ⚠️ Issue #2: Firestore Security Rules (PRIMARY CAUSE)
**Status:** Requires user action

**The Real Problem:**
The Firestore security rules at [firestore.rules](firestore.rules#L244-L258) restrict room updates:

```javascript
match /rooms/{roomId} {
  allow read: if isEmployee();
  allow write: if isDesignTeam();  // ← THIS IS THE BLOCKER
}
```

**isDesignTeam()** requires one of:
1. Email = `pravat04@gmail.com` with verified email flag, OR
2. User has a Firestore document `/users/{userId}` with `role: "Design Team"`

## Solution Steps

### Step 1: Check Current User Role
1. Open Chrome DevTools (F12)
2. Go to Console tab
3. Run this command:
   ```javascript
   firebase.auth().currentUser.then(user => {
     console.log('Current User:', user.email, user.uid);
     // Note the uid, you'll need it
   });
   ```
4. Note the user's email and UID

### Step 2: Option A - If User is pravat04@gmail.com
- Email is already whitelisted ✓
- Just ensure email is verified in Firebase Auth
- Clear browser cache: Ctrl+Shift+Delete
- Try update again

### Step 3: Option B - If User is Different Email
You need to add them to Firestore with proper role.

**Add User Document to Firestore:**

1. Go to Firebase Console → Firestore Database
2. Create a document at path: `/users/{USER_UID}`
3. Add these fields:
   ```
   email: "user@example.com"   (string)
   role: "Design Team"          (string)
   displayName: "User Name"      (string, optional)
   lastLogin: (today's date)    (timestamp)
   photoURL: ""                 (string, optional)
   ```

Example structure:
```
/users/abc123def456
├── email: "engineer@company.com"
├── role: "Design Team"
├── displayName: "John Engineer"
└── lastLogin: (timestamp)
```

### Step 4: Verify & Test
1. Clear browser cache (Ctrl+Shift+Delete)
2. Refresh the page
3. Try updating a room input
4. Should see "Saved" status instead of "Update failed"

## Error Messages After Fix

You'll now see more helpful error messages:

| Error | Cause | Solution |
|-------|-------|----------|
| "Update failed: Missing or insufficient permissions" | Security rule blocked write | Check user role in Firestore |
| "Update failed: No document to update" | Room was deleted in another session | Refresh and retry |
| "Update failed: Invalid data type" | Bad input format | Check console logs for details |

## Debugging Commands

Run these in Chrome DevTools Console:

### Check User Authentication
```javascript
firebase.auth().currentUser.then(user => {
  console.log('User:', user.email, user.uid);
  console.log('Email Verified:', user.emailVerified);
});
```

### Check User Role in Firestore
```javascript
firebase.firestore().collection('users').doc('USER_UID_HERE').get().then(doc => {
  console.log('User Document:', doc.data());
});
```

### View Console Errors (Most Helpful)
1. Open DevTools → Console tab
2. Make a room update
3. Look for error logs like:
   ```
   [LoadCalculator] Failed to persist room analysis snapshot: 
   {roomId: "room123", error: FirebaseError: ...}
   ```

## Files Changed

- `src/components/hvac/LoadCalculator.tsx`
  - ✅ Added error handling to `persistRoomAnalysisSnapshot()`
  - ✅ Improved error messages in `updateRoom()`

## Next Steps

1. **Check Firestore user role** (see Step 2 above)
2. **Add/update user document** if needed (see Step 3)
3. **Clear browser cache** and refresh
4. **Test room update** - should work now!

If you still see "Update failed" after these steps:
1. Check browser DevTools → Console for detailed error message
2. Verify user has "Design Team" role in Firestore `/users/{uid}`
3. Check Firestore security rules haven't changed

---

**Questions?**
- Check `/users/{userId}` document exists in Firestore
- Verify `role` field = exactly `"Design Team"` (case-sensitive)
- Clear browser cache thoroughly (sometimes cached auth persists)
- Check email is verified if using admin email
