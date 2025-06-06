require("dotenv").config()
const jwt = require("jsonwebtoken")
const marked = require("marked")
const sanitizeHTML = require("sanitize-html")
const bcrypt = require("bcrypt")
const cookieParser = require("cookie-parser")
const express = require("express")
const db = require("better-sqlite3") ("myApp.db")
db.pragma("foreign_keys = ON")
db.pragma("journal_mode = WAL")

// database setup here
if (process.env.NODE_ENV === "development") {
  db.exec(`DROP TABLE IF EXISTS posts`);
  db.exec(`DROP TABLE IF EXISTS users`);
 
  const createTables = db.transaction(() => {
    db.prepare(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username STRING NOT NULL UNIQUE,
        password STRING NOT NULL
      )
    `).run()

    db.prepare(`
      CREATE TABLE posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        createdDate TEXT,
        title STRING NOT NULL,
        body TEXT NOT NULL,
        authorid INTEGER,
        FOREIGN KEY (authorid) REFERENCES users(id)
      )
    `).run()
  });

  createTables();
  // database setup ends here
}

const app = express()

app.set("view engine", "ejs")
app.use(express.urlencoded({extended: false }))
app.use(express.static("public"))
app.use(cookieParser())

// this is a middleware
app.use(function (req, res, next) {
   // make our markdown function available
   res.locals.filterUserHTML = function(content) {
      return sanitizeHTML(marked.parse(content), {
         allowedTags: ["p", "br", "ul", "li", "ol", "strong","bold", "i", "em", "h1", "h2", "h3", "h4", "h5", "h6"],
         allowedAttributes: {}
      })
   }
      res.locals.errors = []

      // try to decode the incoming cookie
      try {
         const decoded = jwt.verify(req.cookies.mySimpleApp, process.env.JWTSECRET)
         req.user = decoded;

      } catch(err) {
         req.user = false;
      }

      res.locals.user = req.user
      console.log(req.user);
      next()
})

// setting up the routes
app.get("/", (req, res) => {
   if(req.user) {
      const postsStatement = db.prepare("SELECT * FROM posts WHERE authorid = ? ORDER BY createdDate DESC")
      const posts = postsStatement.all(req.user.userId)
      return res.render("dashboard", { posts })
   }

   res.render("homepage")
})

app.get("/login", (req, res) => {
   res.render("login")
})

app.post("/login", (req, res) => {
   // validate the user Input
    let errors = []

    if(typeof req.body.username !== "string") req.body.username = ""
    if(typeof req.body.password !== "string") req.body.password = ""

    if (req.body.username.trim() == "") errors = ["Invalid username / password."]
    if (req.body.password == "") errors = ["Invalid username / password."]
    
    if (errors.length) {
      return res.render("login", {errors})
    }

    // if there is no error in the login,
    // I will have to look up the username in the database
    // And we compare if the password match or not.
    const userInQuestionStatement = db.prepare("SELECT * FROM users WHERE USERNAME = ?")
    const userInQuestion = userInQuestionStatement.get(req.body.username)

    if(!userInQuestion) {
       errors = ["invalid username/ password"]
       return res.render("login", {errors})
    }

    const matchOrNot = bcrypt.compareSync(req.body.password, userInQuestion.password)
    if(!matchOrNot) {
      errors = ["invalid username/ password"]
      return res.render("login", {errors})
    }

    // give the user a cookie
    const myTokenValue = jwt.sign(
      {exp: Math.floor(Date.now()/1000) + 60 * 60 * 24, skyColor: "blue", userId: userInQuestion.id, username: userInQuestion.username},process.env.JWTSECRET)

   res.cookie("mySimpleApp", myTokenValue,{
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24
   })

   // redirect the user to the homepage
   res.redirect("/")
    

})

app.get("/logout", (req, res) => {
   res.clearCookie("mySimpleApp")
   res.redirect("/")
})

// lets create a middleware to make usre that a user is logged in
// before he can create a post.

function mustBeLoggedIn(req, res, next) {
   if(req.user) {
      return next()
   } 
   return res.redirect("/")
}

app.get("/create-post", mustBeLoggedIn, (req, res) => {
   res.render("create-post")
})

function sharedPostValidation(req) {
   const errors = []
   if (typeof req.body.title !== "string") req.body.title = " "
   if (typeof req.body.body !== "string") req.body.body = " "

   // trim - sanitize or strip out html
   req.body.title = sanitizeHTML(req.body.title.trim(), {allowedTags: [], allowedAttributes: {}})
   req.body.body = sanitizeHTML(req.body.body.trim(), {allowedTags: [], allowedAttributes: {}})

   if(!req.body.title) errors.push("You must provide a title.")
   if(!req.body.body) errors.push("You must provide content.")

   return errors
}

app.get("/edit-post/:id", mustBeLoggedIn, (req,res) => {
   // try to look up the in question
   const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
   const post = statement.get(req.params.id)

   if(!post) {
      return res.redirect("/")
   }

   //if your are not the author, redirect to homepage
   if(post.authorid !== req.user.userId) {
      return res.redirect("/")
   }

   // otherwise, render the edit post template
   res.render("edit-post", {post})
})

app.post("/edit-post/:id", mustBeLoggedIn, (req, res) => {
   const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
   const post = statement.get(req.params.id)

   if(!post) {
      return res.redirect("/")
   }

   //if your are not the author, redirect to homepage
   if(post.authorid !== req.user.userId) {
      return res.redirect("/")
   }

      const errors = sharedPostValidation(req)

      if(errors.length) {
         return res.render("edit-post", {errors})
      }

      // if there are no errors, lets update the database
      const updateStatement = db.prepare("UPDATE posts SET title = ?, body = ? WHERE id = ?")
      updateStatement.run(req.body.title, req.body.body, req.params.id)

      res.redirect(`/post/${req.params.id}`)
})

app.post("/delete-post/:id", mustBeLoggedIn, (req, res) => {
      const statement = db.prepare("SELECT * FROM posts WHERE id = ?")
      const post = statement.get(req.params.id)

      if(!post) {
         return res.redirect("/")
      }

      //if your are not the author, redirect to homepage
      if(post.authorid !== req.user.userId) {
         return res.redirect("/")
      }

      const deleteStatement = db.prepare("DELETE FROM posts WHERE id = ?")
      deleteStatement.run(req.params.id)

      res.redirect("/")
})

app.get("/post/:id", (req, res) => {
   const statement = db.prepare("SELECT posts.*, users.username FROM posts INNER JOIN users ON posts.authorid = users.id WHERE posts.id = ?")
   const post = statement.get(req.params.id)
   if(!post) {
      return res.redirect("/")
   }

   const isAuthor = post.authorid === req.user.userId
   res.render("single-post", {post, isAuthor})

})

app.get("/register", (req, res) => {
  res.render("register")  // render the register.ejs view
})

app.post("/create-post", mustBeLoggedIn, (req, res) => {
    // we validate the body and the title fields
    const errors = sharedPostValidation(req)

    if(errors.length) {
      return res.render("create-post", {errors})
    }

    // ✅ Check if user still exists in the DB
    const userExists = db.prepare("SELECT id FROM users WHERE id = ?").get(req.user.userId);
    if (!userExists) {
      res.clearCookie("mySimpleApp");
      return res.redirect("/login");
    }

    // if there is no error, save into the database
    const myStatement = db.prepare("INSERT INTO posts (title, body, authorid, createdDate) VALUES (?,?,?,?)")
    const result = myStatement.run(req.body.title, req.body.body, req.user.userId, new Date().toISOString())

    const post = db.prepare("SELECT * FROM posts WHERE rowid = ?").get(result.lastInsertRowid);
    res.redirect(`/post/${post.id}`);


});
 
app.post("/register", (req, res) => {
    // validate the user Input
    const errors = []

    if(typeof req.body.username !== "string") req.body.username = ""
    if(typeof req.body.password !== "string") req.body.password = ""

    req.body.username = req.body.username.trim()

    // username Validation
    if(!req.body.username) errors.push("You must provide a username.")
    if(req.body.username && req.body.username.length < 3) errors.push("Username must be atleast 3 characters.")
    if(req.body.username && req.body.username.length > 10) errors.push("Username cannot exceed 10 characters.")
   
   // to ensure that they don't have special characters
    if(req.body.username && !req.body.username.match(/^[a-zA-Z0-9]+$/)) errors.push("Username can only contain letters and numbers")
   
   // check if username already exists
   const usernameStatement = db.prepare("SELECT * FROM users WHERE username = ?")
   const usernameCheck = usernameStatement.get(req.body.username)

   if(usernameCheck) errors.push("That username is already taken!")
   
    // password validation
    if(!req.body.password) errors.push("You must provide a password.")
    if(req.body.password && req.body.password.length < 8) errors.push("Password must be atleast 8 characters.")
    if(req.body.password && req.body.password.length > 15) errors.push("Password cannot exceed 15 characters.")

   if(errors.length) {
      return res.render("homepage", {errors})
   } 

   // save the new user into a database
   // lets hash the password before saving to the database
   const salt = bcrypt.genSaltSync(10)
   req.body.password = bcrypt.hashSync(req.body.password, salt)


   const myStatement = db.prepare("INSERT INTO users (username, password) VALUES (?, ?)")
   const result = myStatement.run(req.body.username, req.body.password)

   const lookUpStatement = db.prepare("SELECT * FROM users WHERE ROWID = ?")
   const myUser = lookUpStatement.get(result.lastInsertRowid)

 
   // log the user in by given them a cookie.
   // lets generate the long secure value for the
   // cookie
   const myTokenValue = jwt.sign(
      {exp: Math.floor(Date.now()/1000) + 60 * 60 * 24, skyColor: "blue", userId: myUser.id, username: myUser.username},process.env.JWTSECRET)

   res.cookie("mySimpleApp", myTokenValue,{
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      maxAge: 1000 * 60 * 60 * 24
   })

   res.redirect("/")

    
})

app.listen(3000)