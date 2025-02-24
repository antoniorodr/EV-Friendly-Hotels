from flask import Flask, jsonify, render_template, request, redirect, url_for, flash
from flask_sqlalchemy import SQLAlchemy
from flask_bootstrap import Bootstrap5
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy import Integer, String, Float
import csv
import folium
from flask_wtf import FlaskForm, CSRFProtect
from wtforms import StringField, SubmitField
from wtforms.validators import DataRequired, Length
import secrets
import re
import os
import smtplib
from markupsafe import Markup

app = Flask(__name__)
app.secret_key = os.environ["secret_key"]
class Base(DeclarativeBase):
    pass


app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///chargers.db"
db = SQLAlchemy(model_class=Base)
db.init_app(app)
Bootstrap5(app)
csrf = CSRFProtect(app)

class SearchForm(FlaskForm):
    name = StringField("Search for a charge station", validators=[DataRequired(), Length(1, 40)])
    submit = SubmitField("Submit")

class TokenForm(FlaskForm):
    email = StringField("Write your email and click submit to get the token", validators=[DataRequired(), Length(7, 70)])
    submit = SubmitField("Submit")

class Charger(db.Model):
    __tablename__ = "chargers"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[str] = mapped_column(String(250), nullable=False)
    name: Mapped[str] = mapped_column(String(250), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    longitude: Mapped[float] = mapped_column(Float(20), nullable=False)
    latitude: Mapped[float] = mapped_column(Float(20), nullable=False)
    maps_link: Mapped[str] = mapped_column(String(250), nullable=False)

    def to_dict(self):
        return {column.name: getattr(self, column.name) for column in self.__table__.columns}
    
class Token(db.Model):
    __tablename__= "tokens"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token: Mapped[str] = mapped_column(String(250), nullable=False)
    email: Mapped[str] = mapped_column(String(50), nullable=False, unique=True)


with app.app_context():
    db.create_all()

def csv_to_db():
    with open ("data/EV-friendly chargers in Europe.csv") as file:
        reader = csv.DictReader(file)
        for row in reader:
            with app.app_context():
                new_charger = Charger(
                    name=row["Name"], 
                    type=row["layer_name"], 
                    description=row["Description"],  
                    longitude=row["longitude"],  
                    latitude=row["latitude"],  
                    maps_link=row["Maps link"],  
                )

                db.session.add(new_charger)
                db.session.commit()

def generate_token():
    token = secrets.token_urlsafe(20)
    return token


@app.route("/")
def home():
  return render_template("index.html")


@app.route("/all")
def all_chargers():
    my_map = folium.Map(location = [52.8806586, 14.559359],
                                            zoom_start = 4 )
    page = request.args.get("page", 1, type=int)
    charger_type = request.args.get("type", None)
    
    charger_types = db.session.query(Charger.type).distinct().all()
    charger_types = [ht[0] for ht in charger_types]
    
    if charger_type:
        with open ("data/EV-friendly chargers in Europe.csv") as file:
            reader = csv.DictReader(file)
            for row in reader:
                if row["layer_name"] == charger_type:
                    folium.Marker([row["latitude"], row["longitude"]],
                        popup = row["Name"]).add_to(my_map)
        my_map.save("templates/my_map.html")
        chargers = Charger.query.filter_by(type=charger_type).paginate(page=page, per_page=10)
    else:
        with open ("data/EV-friendly chargers in Europe.csv") as file:
            reader = csv.DictReader(file)
            for row in reader:
                folium.Marker([row["latitude"], row["longitude"]],
                    popup = row["Name"]).add_to(my_map)
        my_map.save("templates/my_map.html")
        chargers = Charger.query.paginate(page=page, per_page=10)
    
    return render_template("all_chargers.html", chargers=chargers, charger_types=charger_types)

@app.route("/search", methods=['GET', 'POST'])
def search():
    form = SearchForm()
    message = ""
    chargers = []
    
    if form.validate_on_submit():
        pattern = f"%{form.name.data}%"
        result = db.session.execute(db.select(Charger).where(Charger.name.ilike(pattern)))
        chargers = result.scalars().all()
        if chargers:
            if len(chargers) == 1:
                return redirect(url_for("charger", charger_id=chargers[0].id))
            elif len(chargers) > 1:
                return render_template("chargers.html", chargers=chargers)
        else:
            message = "That search term is not in our database."
    return render_template("search.html", form=form, message=message, chargers=chargers)


@app.route("/charger/<int:charger_id>")
def charger(charger_id):
    charger = db.session.get(Charger, charger_id)
    if charger is None:
        return "charger not found", 404
    return render_template("charger.html", charger=charger)

@app.route("/get_token", methods = ["GET", "POST"])
def get_token():
    form = TokenForm()
    if form.validate_on_submit():
        email_check = re.compile(r"^(?!\.)[\w\-_.]+[^.]@\w+([\.-]\w+)*\.\w{2,}$")
        result = re.search(email_check, form.email.data)
        check_user = db.session.execute(db.select(Token).where(Token.email == form.email.data))
        user = check_user.scalar()
        if user:
            flash(Markup("You have already received a token. Please check your email. If you can't find it or don't remember it, feel free to get in touch through: <a href='mailto:pythoncodingacc69@gmail.com'>pythoncodingacc69@gmail.com</a>"), "info")
        if result and not user:
            token = generate_token()
            new_token = Token(
                token = token,
                email = form.email.data
            )
            db.session.add(new_token)
            db.session.commit()
            with smtplib.SMTP(os.environ["SMTP_ADDRESS"], port=587) as connection:
                connection.starttls()
                connection.login(user=os.environ["email"], password=os.environ["password"])
                connection.sendmail(
                    from_addr=os.environ["email"],
                    to_addrs=form.email.data,
                    msg=f"Subject:Here is your token!\n\n{token}".encode("utf-8"),
                )
                flash("An email with your token has been sent. Check your inbox. If you haven't received an email with the token, please check your junk mail folder.")
    return render_template("token.html", form=form)


@app.route("/map")
def map():
    return render_template("my_map.html")


@app.route("/api/add", methods = ["POST"])
def new_charger():
    types = ["Hotels and accomodation, charging on private premises", "Charging only (no accomodation)", "Hotel, charging station nearby", "Superchargers", "Tesla Destination Chargers", "Hotel @ Supercharger"]
    token = request.headers.get("token")
    check_token_result = db.session.execute(db.select(Token).where(Token.token == token))
    check_token = check_token_result.scalars().first()
    type_ = request.form.get("type")
    if type_ not in types:
        return jsonify(error={"message": f"The type should be one of the follow: {types}"}), 400
    longitude = request.form.get("longitude")
    latitude = request.form.get("latitude")
    existing_charger = db.session.query(Charger).filter_by(longitude=longitude, latitude=latitude).first()
    if existing_charger:
        return jsonify(error={"message": "A charger with this coordinates already exists."}), 400
    if check_token:
        new_charger = Charger(
            name=request.form.get("name"), 
            type=request.form.get("layer_name"), 
            description=request.form.get("description"),  
            longitude=request.form.get("longitude"),  
            latitude=request.form.get("latitude"),  
            maps_link=request.form.get("maps_link"),  
        )
        db.session.add(new_charger)
        db.session.commit()
        return jsonify(response={"success": "Successfully added the new charger."}), 200
    return jsonify(error={"error": "You need a valid token."}), 401

@app.route("/api/all")
def all_cafe():
    token = request.headers.get("token")
    check_token_result = db.session.execute(db.select(Token).where(Token.token == token))
    check_token = check_token_result.scalars().first()
    if check_token:
        result = db.session.execute(db.select(Charger).order_by(Charger.id))
        all_chargers = result.scalars().all()
        return jsonify(chargers=[charger.to_dict() for charger in all_chargers])
    return jsonify(error={"error": "You need a valid token."}), 401

@app.route("/api/search/")
def search_cafe():
    token = request.headers.get("token")
    check_token_result = db.session.execute(db.select(Token).where(Token.token == token))
    check_token = check_token_result.scalars().first()
    query = f"%{request.args.get('location')}%"
    if check_token:
        result = db.session.execute(db.select(Charger).where(Charger.name.ilike(query)))
        all_chargers = result.scalars().all()
        if all_chargers:
            return jsonify(chargers=[charger.to_dict() for charger in all_chargers])
        else:
            return jsonify(error={"Not Found": "Sorry, we don't find a charger at that location."}), 404
    return jsonify(error={"error": "You need a valid token."}), 401


@app.route("/update/<charger_id>", methods = ["PATCH"])
def update(charger_id):
    token = request.headers.get("token")
    check_token_result = db.session.execute(db.select(Token).where(Token.token == token))
    check_token = check_token_result.scalars().first()
    new_description = request.form.get("description")
    result = db.get_or_404(Charger, charger_id)
    if check_token:
        if result:
            result.description = f"{new_description}"
            db.session.commit()
            return jsonify(response={"success": "Successfully updated the description."}), 200
        else:
            return jsonify(error={"Not Found": "Sorry, a charger with that ID was not found in the database."}), 404
    return jsonify(error={"error": "You need a valid token."}), 401


if __name__ == "__main__":
  app.run(debug=True)
    # csv_to_db()