const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const jwt = require("jsonwebtoken");
require("dotenv").config();
const cors = require("cors");
const moment = require("moment");
const port = process.env.PORT || 5000;


app.use(cors({
  origin: ['http://localhost:5173', 'https://core-bits.firebaseapp.com', 'https://core-bits.web.app'],
  credentials: true
}));
app.use(express.json());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.ocam1.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    // Send a ping to confirm a successful connection

    const assetCollection = client.db("coreBits").collection("assets");
    const hrDataCollection = client.db("coreBits").collection("hrData");
    const usersCollection = client.db("coreBits").collection("users");
    const requestsCollection = client.db("coreBits").collection("requests");

    // JWT
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // Custom MiddleWare:
    // Verify Token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authentication) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authentication.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };

    // verify HR
    const verifyHr = async(req, res, next) => {
      const email = req.decoded.email;
      const query = {email : email}
      const user = await usersCollection.findOne(query);
      const isHr = user?.role === 'hr'
      if(!isHr){
        return res.status(403).send({message: 'forbidden access'});
      }
      next();
    }

    // verify Employee
    const verifyEmployee = async(req, res, next) => {
      const email = req.decoded.email;
      const query = {email : email}
      const user = await usersCollection.findOne(query);
      const isEmployee = user?.role === 'employee'
      if(!isEmployee){
        return res.status(403).send({message: 'forbidden access'});
      }
      next();
    }



    // common api
    app.get("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if(email !== req.decoded?.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });


    app.get('/hr-info/:email',verifyToken, async(req,res)=>{
      const email = req.params.email;

      if(email !== req.decoded.email){
        return res.status(403).send({message: 'forbidden access'})
      }

      const query = {email : email}

      const projection = {projection: { company: 1, company_logo: 1 }}

      const hrData = await hrDataCollection.findOne(query)
      if(hrData){
        return res.send(hrData)
      }

      const user = await usersCollection.findOne(query)
      if(user && user.hrEmail){
        const hrData = await hrDataCollection.findOne({email : user.hrEmail}, projection)

        if(hrData){
          return res.send(hrData)
        }
      }

    })


    app.post("/users", verifyToken, async (req, res) => {
      const user = req.body;
      const query = { email : user.email}
      const existsUser = await usersCollection.findOne(query)
      if(existsUser){
        res.send({message: 'user already exists', insertedId: null})
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });


    app.post("/hr-info", verifyToken, async (req, res) => {
      const hrInfo = req.body;
      const query = {email : hrInfo.email}
      const existsUser = await usersCollection.findOne(query)
      if(existsUser){
        res.send({message: 'user already exists', insertedId: null})
      }
      const result = await hrDataCollection.insertOne(hrInfo);
      res.send(result);
    });

    app.get("/user/user-role/:email",verifyToken, async(req,res)=>{
      const email = req.params.email;
      if(email !== req.decoded?.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = {email : email}
      const user = await usersCollection.findOne(query);

      let userRole = false;
      if(user){
        userRole = user?.role === 'user';
      }
      res.send({ userRole })
    })



    // HR api section

// isHr
    app.get("/user/hr/:email",verifyToken, async(req,res)=>{
      const email = req.params.email;
      if(email !== req.decoded?.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = {email : email}
      const user = await usersCollection.findOne(query);

      let hr = false;
      if(user){
        hr = user?.role === 'hr';
      }
      res.send({ hr })
    })

    app.get("/hr-stats",verifyToken,verifyHr, async(req,res)=>{
      const email = req.query.email;
      const query = { hr_email : email}

      const allRequests = await requestsCollection.find(query).toArray();

      // Pending Requests
      const pendingRequests = allRequests.filter(request => request.status === 'pending').slice(0,5);

      // Type Check
      const typeCounts = allRequests.reduce((count,request)=> {
        if(request.asset_type === 'returnable'){
          count.returnable++
        }
        else if(request.asset_type === 'non-returnable'){
          count.nonReturnable++
        }
        return count;
      },
      {returnable:0, nonReturnable:0}
    )

      // limited stock
      const limitedStockQuery = { hr_email:email ,product_quantity: { $lt:10 }};
      const limitedStock = await assetCollection.find(limitedStockQuery).toArray();

      // Top Requests
      const requesterCount = allRequests.reduce((acc, request)=>{
        acc[request.asset_id] = (acc[request.asset_id] || 0) + 1;
        return acc
      }, {});

      const topRequestedId = Object.entries(requesterCount)
      .sort((a,b)=> b[1] - a[1]).slice(0,4)
      .map(([asset_id]) => asset_id);

      const topRequestedQuery = { _id : {$in: topRequestedId.map(id=> new ObjectId(id))}};
      const topRequested = await assetCollection.find(topRequestedQuery).toArray();
 

      res.send({pendingRequests, limitedStock, typeCounts, topRequested})
    })

    app.get("/assets", verifyToken,verifyHr, async (req, res) => {
      const filter = req.query;
      const query = { 
        hr_email: filter.email,
        product_name: {$regex: filter.search, $options: 'i'}
      };

      const assets = await assetCollection
        .find(query)
        .sort({ _id: -1 })
        .toArray();

      let result = assets;
      if(filter.sort === 'high'){
        result.sort((a,b)=> b.product_quantity - a.product_quantity)
      }
      else if(filter.sort === "low"){
        result.sort((a,b)=> a.product_quantity - b.product_quantity)
      }

      if(filter.status === 'available'){
        result = result.filter(asset => asset.product_quantity > 0)
      }
      else if(filter.status === 'out-of-stock'){
        result = result.filter(asset => asset.product_quantity <= 0)
      }

      if(filter.type === 'returnable'){
        result = result.filter(asset => asset.product_type === 'returnable')
      }
      else if(filter.type === 'non-returnable'){
        result = result.filter(asset => asset.product_type === 'non-returnable')
      }


      res.send(result);
    });

    app.get("/assets/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await assetCollection.findOne(filter);
      res.send(result);
    });


    app.delete("/assets/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await assetCollection.deleteOne(query);
      res.send(result);
    });

    app.patch("/assets/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const updatedAsset = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          product_name: updatedAsset.product_name,
          img: updatedAsset.img,
          product_type: updatedAsset.product_type,
          product_quantity: updatedAsset.product_quantity,
        },
      };
      const result = await assetCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.patch("/assets-quantity/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const updatedAsset = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          product_quantity: updatedAsset.product_quantity,
        },
      };
      const result = await assetCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.post("/assets", verifyToken,verifyHr, async (req, res) => {
      const asset = req.body;
      const result = await assetCollection.insertOne(asset);
      res.send(result);
    });

    app.get("/users", verifyToken,verifyHr, async (req, res) => {
      const role = req.query.role;
      const checkRole = { role: role };
      const result = await usersCollection.find(checkRole).toArray();
      res.send(result);
    });

    app.get("/users-hr-email", verifyToken,verifyHr, async (req, res) => {
      const hrEmail = req.query.hrEmail;
      const checkHrEmail = { hrEmail: hrEmail };
      const result = await usersCollection.find(checkHrEmail).toArray();
      res.send(result);
    });

    app.patch("/users/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const updateUser = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          role: updateUser.updateRole,
          hrEmail: updateUser.updateHrEmail,
        },
      };
      const result = await usersCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.patch("/hr-info/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const updatePackage = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          package: updatePackage.package,
        },
      };
      const result = await hrDataCollection.updateOne(filter, updateDoc);
      res.send(result);
    });


    app.get("/hr-requests", verifyToken,verifyHr, async (req, res) => {
      const filter = req.query;
      const query = { 
        hr_email: filter.email,
        requester_name: {$regex: filter.search, $options: 'i'} 
      };
      const result = await requestsCollection
        .find(query)
        .sort({ _id: -1 })
        .toArray();
      res.send(result);
    });

    app.patch("/requests/:id", verifyToken,verifyHr, async (req, res) => {
      const id = req.params.id;
      const updateAsset = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          approve_date: updateAsset.approve_date,
          status: updateAsset.status,
        },
      };
      const result = await requestsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.delete("/reject/:id", verifyToken, verifyHr, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestsCollection.deleteOne(query);
      res.send(result);
    });

    

    // Employee api section

    // isEmployee
    app.get("/user/employee/:email",verifyToken, async(req,res)=>{
      const email = req.params.email;
      if(email !== req.decoded?.email){
        return res.status(403).send({message: 'forbidden access'})
      }
      const query = {email : email}
      const user = await usersCollection.findOne(query);

      let employee = false;
      if(user){
        employee = user?.role === 'employee';
      }
      res.send({ employee })
    })


    app.get("/hr-assets", verifyToken,verifyEmployee, async (req, res) => {
      const filter = req.query;
      const query = {
         hr_email: filter.email,       
        product_name: {$regex: filter.search, $options: 'i'},
        };
      const assets = await assetCollection.find(query).sort({ _id: -1 }).toArray();

      let result = assets;

      if (filter.type === "returnable") {
        result = result.filter((asset) => asset.product_type === "returnable");
      } else if (filter.type === "non-returnable") {
        result = result.filter((asset) => asset.product_type === "non-returnable");
      }

      if(filter.status === "available"){
        result = result.filter((asset)=> asset.product_quantity > 0)
      }
      else if(filter.status === "out-of-stock"){
        result = result.filter((asset)=> asset.product_quantity === 0)
      }

      res.send(result);
    });

    app.get("/asset/:id", verifyToken,verifyEmployee, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const result = await assetCollection.findOne(filter);
      res.send(result);
    });


    app.patch("/assets-quantity-update/:id", verifyToken,verifyEmployee, async (req, res) => {
      const id = req.params.id;
      const updatedAsset = req.body;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = {
        $set: {
          product_quantity: updatedAsset.product_quantity,
        },
      };
      const result = await assetCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    
    app.get("/team-hr-email", verifyToken,verifyEmployee, async (req, res) => {
      const hrEmail = req.query.hrEmail;
      const checkHrEmail = { hrEmail: hrEmail };
      const result = await usersCollection.find(checkHrEmail).toArray();
      res.send(result);
    });


    app.get("/requests", verifyToken, verifyEmployee, async (req, res) => {
      const email = req.query.email;
      const query = { requester_email: email };
      const allRequests = await requestsCollection.find(query).sort({ _id : -1 }).toArray();
      const pendingRequests = allRequests.filter(request => request.status === 'pending')

      const currentMonth = moment().month();
      const currentYear = moment().year();
      const currentMonthRequests = allRequests.filter(request => {
        const requestDate = moment(request.request_date, "YYYY-MM-DD");
        return requestDate.month() === currentMonth && requestDate.year() === currentYear;
      })

      res.send({pendingRequests, currentMonthRequests});
    });

    app.get("/request-assets",verifyToken,verifyEmployee, async (req, res) => {
      const filter = req.query;
      const query = { 
        requester_email: filter.email,
        asset_name: {$regex: filter.search, $options: 'i'} 
      };

      const allRequests = await requestsCollection.find(query).sort({ _id : -1 }).toArray();

      let result = allRequests;

      if (filter.status === "pending") {
        result = result.filter((request) => request.status === "pending");
      } else if (filter.status === "approved") {
        result = result.filter((request) => request.status === "approved");
      }
      else if (filter.status === "returned") {
        result = result.filter((request) => request.status === "returned");
      }
  
      if (filter.type === "returnable") {
        result = result.filter((request) => request.asset_type === "returnable");
      } else if (filter.type === "non-returnable") {
        result = result.filter((request) => request.asset_type === "non-returnable");
      }
    


      // const result = await requestsCollection.find(query).sort({ _id : -1 }).toArray();
      res.send(result);
    });

    

    app.delete("/requests/:id", verifyToken,verifyEmployee, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await requestsCollection.deleteOne(query);
      res.send(result);
    });


    app.patch("/requested/:id", verifyToken,verifyEmployee, async (req, res) => {
      const id = req.params.id;
      const updateAsset = req.body;
      const filter = { _id: new ObjectId(id) };
      const updateDoc = {
        $set: {
          approve_date: updateAsset.approve_date,
          status: updateAsset.status,
        },
      };
      const result = await requestsCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    

    app.post("/requests", verifyToken,verifyEmployee, async (req, res) => {
      const request = req.body;
      const result = await requestsCollection.insertOne(request);
      res.send(result);
    });




    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("coreBits is Running....");
});

app.listen(port, () => {
  `coreBits is running on Port ${port}`;
});
